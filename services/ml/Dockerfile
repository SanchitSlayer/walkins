# Transcription and embeddings for the worker, over HTTP. Deliberately lean:
# no PyTorch. faster-whisper runs on CTranslate2, and the embedding model runs
# on ONNX Runtime, which faster-whisper already installs. Model weights are
# not in the image; they download on first start into the /models volume.
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/hf
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app.py .
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
