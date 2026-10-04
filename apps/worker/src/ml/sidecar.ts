// The Python sidecar (services/ml): transcription and embeddings over HTTP.
const ML_URL = process.env.ML_URL ?? "http://localhost:8001";
// Whisper on a CPU takes a few seconds for 45 seconds of audio; the first
// request after a restart also loads the model.
const TRANSCRIBE_TIMEOUT_MS = 3 * 60_000;

// The sidecar refused the recording itself (unreadable, empty, too long).
// Sending it again can't help, so this is never retried.
export class AudioRefusedError extends Error {
  name = "AudioRefusedError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export type Transcription = {
  language: string;
  languageProbability: number;
  durationSeconds: number;
  noSpeech: boolean;
  text: string;
  avgLogprob: number | null;
  noSpeechProb: number | null;
  compressionRatio: number | null;
};

export async function transcribe(audio: Buffer): Promise<Transcription> {
  const response = await fetch(`${ML_URL}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: audio,
    signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
  });
  if (response.status === 422) {
    const { detail } = (await response.json()) as { detail: { code: string; message: string } };
    throw new AudioRefusedError(detail.code, detail.message);
  }
  if (!response.ok) throw new Error(`The transcription service answered ${response.status}`);
  return (await response.json()) as Transcription;
}

export async function embed(texts: string[]): Promise<number[][]> {
  const response = await fetch(`${ML_URL}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`The embedding service answered ${response.status}`);
  return ((await response.json()) as { vectors: number[][] }).vectors;
}
