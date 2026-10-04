"""Transcription and embeddings for the Walkins worker.

Two endpoints, both stateless; models load once at startup (downloading into
the /models volume on the very first start, which is slow) and stay in memory.
"""

import io
import os
import platform
from contextlib import asynccontextmanager

import numpy as np
import onnxruntime as ort
from av.error import FFmpegError
from fastapi import FastAPI, HTTPException, Request
from faster_whisper import BatchedInferencePipeline, WhisperModel, decode_audio
from huggingface_hub import hf_hub_download
from pydantic import BaseModel, Field
from tokenizers import Tokenizer

SAMPLE_RATE = 16_000
# Intros are capped at 45 seconds in the browser; a little slack for encoder
# padding, and a hard stop for anything that got around the client.
MAX_SECONDS = 50
THREADS = int(os.environ.get("ML_THREADS", "4"))
# Whisper decodes at most 448 tokens per window, and Devanagari costs several
# byte-level tokens a character, so a full 30-second window of Hindi runs out
# and the rest of the speech is dropped without any error. Splitting at pauses
# into pieces of at most 15 seconds keeps each piece well under the limit.
CHUNK_SECONDS = 15

# Multilingual on purpose: the English-only MiniLM turns Devanagari into
# near-meaningless vectors, which would break matching for exactly the
# candidates who record in Hindi. Same 384 dimensions. The int8 build for this
# CPU is a quarter of the size of the float one and gives the same vectors to
# within rounding, as long as every vector comes from the same build.
EMBED_REPO = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
EMBED_FILE = (
    "onnx/model_qint8_arm64.onnx" if platform.machine() in ("aarch64", "arm64") else "onnx/model_quint8_avx2.onnx"
)
# The model's own training length; a 45-second transcript can run past it and
# the tail is then not embedded.
EMBED_MAX_TOKENS = 128

models: dict = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    models["whisper"] = BatchedInferencePipeline(
        WhisperModel(
            os.environ.get("WHISPER_MODEL", "small"),
            device="cpu",
            compute_type="int8",
            cpu_threads=THREADS,
            download_root="/models/whisper",
        )
    )
    tokenizer = Tokenizer.from_file(hf_hub_download(EMBED_REPO, "tokenizer.json"))
    tokenizer.enable_truncation(max_length=EMBED_MAX_TOKENS)
    tokenizer.enable_padding()
    options = ort.SessionOptions()
    options.intra_op_num_threads = THREADS
    session = ort.InferenceSession(hf_hub_download(EMBED_REPO, EMBED_FILE), options, providers=["CPUExecutionProvider"])
    models["tokenizer"] = tokenizer
    models["embedder"] = session
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {"ok": True}


def refuse(code: str, message: str):
    # 422: the input itself is the problem, so the worker must not retry it.
    raise HTTPException(status_code=422, detail={"code": code, "message": message})


@app.post("/transcribe")
async def transcribe(request: Request):
    body = await request.body()
    if not body:
        refuse("empty", "The recording was empty")
    try:
        # PyAV's bundled FFmpeg: WebM/Opus from Chrome or MP4/AAC from an
        # iPhone in, 16 kHz mono float samples out. No ffmpeg binary needed.
        audio = decode_audio(io.BytesIO(body), sampling_rate=SAMPLE_RATE)
    except FFmpegError:
        refuse("undecodable", "The recording couldn't be read as audio")
    duration = len(audio) / SAMPLE_RATE
    if duration > MAX_SECONDS:
        refuse("too_long", f"The recording is {duration:.0f} seconds; intros can be up to 45")

    segments, info = models["whisper"].transcribe(
        audio,
        task="transcribe",  # never translate: the employer must see what was said, not an English paraphrase
        beam_size=5,
        vad_filter=True,  # cut silence first; Whisper invents text on silence and noise
        condition_on_previous_text=False,  # stops one bad segment seeding a loop of them
        chunk_length=CHUNK_SECONDS,
        batch_size=1,  # one piece at a time keeps memory inside the container's cap
    )
    segments = list(segments)
    text = " ".join(segment.text.strip() for segment in segments).strip()
    result = {
        "language": info.language,
        "languageProbability": round(float(info.language_probability), 4),
        "durationSeconds": round(duration, 2),
    }
    if not text:
        return {**result, "noSpeech": True, "text": "", "avgLogprob": None, "noSpeechProb": None, "compressionRatio": None}

    # Weighted by how long each segment runs, so a short garbled fragment
    # doesn't count as much as the bulk of the recording.
    weights = np.array([max(segment.end - segment.start, 0.01) for segment in segments])
    return {
        **result,
        "noSpeech": False,
        "text": text,
        "avgLogprob": round(float(np.average([s.avg_logprob for s in segments], weights=weights)), 4),
        "noSpeechProb": round(float(np.average([s.no_speech_prob for s in segments], weights=weights)), 4),
        "compressionRatio": round(float(max(s.compression_ratio for s in segments)), 3),
    }


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=64)


@app.post("/embed")
def embed(request: EmbedRequest):
    tokenizer: Tokenizer = models["tokenizer"]
    session: ort.InferenceSession = models["embedder"]
    encodings = tokenizer.encode_batch(request.texts)
    input_ids = np.array([e.ids for e in encodings], dtype=np.int64)
    attention_mask = np.array([e.attention_mask for e in encodings], dtype=np.int64)
    feeds = {"input_ids": input_ids, "attention_mask": attention_mask}
    if any(i.name == "token_type_ids" for i in session.get_inputs()):
        feeds["token_type_ids"] = np.zeros_like(input_ids)
    hidden = session.run(None, feeds)[0]
    # Mean over real tokens (what sentence-transformers does for this model),
    # then unit length so cosine distance in pgvector is a plain dot product.
    mask = attention_mask[..., None].astype(np.float32)
    pooled = (hidden * mask).sum(axis=1) / np.clip(mask.sum(axis=1), 1e-9, None)
    vectors = pooled / np.clip(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12, None)
    return {"vectors": vectors.round(6).tolist()}
