"use client";

import { useEffect, useRef, useState } from "react";
import {
  isMessageKey,
  type MessageKey,
  VOICE_CONTENT_TYPES,
  VOICE_MAX_BYTES,
  VOICE_MAX_SECONDS,
  type VoiceContentType,
  type VoiceIntro,
} from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton } from "@/components/board/field";
import { Slab } from "@/components/board/slab";
import { TranscriptLabel } from "@/components/transcript";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/lib/use-error-text";

const POLL_MS = 2000;

// Chrome and Firefox record webm or ogg, Safari only mp4.
const RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

type Take = { blob: Blob; url: string; contentType: VoiceContentType };

function recorderType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

function baseType(mime: string): VoiceContentType | null {
  const base = mime.split(";")[0].trim();
  return VOICE_CONTENT_TYPES.find((t) => t === base) ?? null;
}

// A failed intro's error is a catalog key the worker stored (voice.failure.*).
function useStatusLine() {
  const t = useTranslations("voice");
  const all = useTranslations();
  return (intro: VoiceIntro) => {
    if (intro.status !== "FAILED") return t(`status.${intro.status}`);
    return intro.error && isMessageKey(intro.error) ? all(intro.error as MessageKey) : t("failure.unreadable");
  };
}

// hasProfile is false until the profile is saved: the recording belongs to
// the candidate row, which doesn't exist before the first save.
export function VoicePanel({ hasProfile }: { hasProfile: boolean }) {
  const t = useTranslations("voice");
  const errorText = useErrorText();
  const statusLine = useStatusLine();
  const [intro, setIntro] = useState<VoiceIntro | null>(null);
  const [recording, setRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(VOICE_MAX_SECONDS);
  const [take, setTake] = useState<Take | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    if (hasProfile) apiClient.getMyVoiceIntro().then(setIntro);
  }, [hasProfile]);

  const pending = intro?.status === "UPLOADED" || intro?.status === "PROCESSING";
  useEffect(() => {
    if (!pending) return;
    const poll = setInterval(async () => setIntro(await apiClient.getMyVoiceIntro()), POLL_MS);
    return () => clearInterval(poll);
  }, [pending]);

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const tick = setInterval(() => {
      const left = VOICE_MAX_SECONDS - Math.floor((Date.now() - started) / 1000);
      setSecondsLeft(Math.max(0, left));
      if (left <= 0) recorder.current?.stop();
    }, 250);
    return () => clearInterval(tick);
  }, [recording]);

  useEffect(() => {
    if (!take) return;
    return () => URL.revokeObjectURL(take.url);
  }, [take]);

  async function start() {
    setError(null);
    const mime = recorderType();
    const contentType = mime && baseType(mime);
    if (!mime || !contentType) {
      setError(t("noRecorder"));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t("micBlocked"));
      return;
    }
    const chunks: Blob[] = [];
    const next = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32_000 });
    next.ondataavailable = (e) => chunks.push(e.data);
    next.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      setRecording(false);
      const blob = new Blob(chunks, { type: contentType });
      setTake({ blob, url: URL.createObjectURL(blob), contentType });
    };
    recorder.current = next;
    setTake(null);
    setSecondsLeft(VOICE_MAX_SECONDS);
    next.start(1000);
    setRecording(true);
  }

  async function upload() {
    if (!take) return;
    if (take.blob.size > VOICE_MAX_BYTES) {
      setError(t("tooLarge"));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      setIntro(await apiClient.uploadVoiceIntro(take.blob, take.contentType));
      setTake(null);
    } catch (err) {
      setError(errorText(err, "errors.voice.uploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Slab depth="md" className="grid w-full gap-4 p-5">
      <div>
        <h2 className="type-h3">{t("heading")}</h2>
        <p className="type-meta mt-1 text-ink-muted">{t("pitch", { seconds: VOICE_MAX_SECONDS })}</p>
      </div>

      {!hasProfile ? (
        <p className="type-meta text-ink-muted">{t("saveFirst")}</p>
      ) : recording ? (
        <div className="grid gap-3">
          <p role="timer" aria-live="off" className="type-board-md">
            {t("recording", { seconds: secondsLeft })}
          </p>
          <BoardButton surface="stock" onClick={() => recorder.current?.stop()}>
            {t("stop")}
          </BoardButton>
        </div>
      ) : take ? (
        <div className="grid gap-3">
          <audio controls src={take.url} className="w-full" />
          <div className="flex flex-wrap gap-3">
            <BoardButton surface="stock" onClick={upload} disabled={uploading}>
              {uploading ? t("sending") : intro ? t("replace") : t("use")}
            </BoardButton>
            <BoardButton surface="stock" variant="quiet" onClick={start} disabled={uploading}>
              {t("again")}
            </BoardButton>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {intro && (
            <div className="grid gap-2">
              <p role="status" className="type-board-md">
                {statusLine(intro)}
              </p>
              {intro.status === "DONE" && intro.transcript && (
                <div className="grid gap-1 border border-ink-muted p-3">
                  <TranscriptLabel
                    language={intro.language}
                    languageProbability={intro.languageProbability}
                    className="text-ink-muted"
                  />
                  <p className="type-body">{intro.transcript}</p>
                  {intro.confidence === "low" && (
                    <p className="type-meta text-ink-muted">{t("lowConfidence")}</p>
                  )}
                </div>
              )}
            </div>
          )}
          <BoardButton surface="stock" variant={intro ? "quiet" : "primary"} onClick={start}>
            {intro ? t("recordNew") : t("record")}
          </BoardButton>
          {intro && (
            <p className="type-meta text-ink-muted">{t("replaces")}</p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="type-meta text-closing-ink">
          {error}
        </p>
      )}
    </Slab>
  );
}
