"use client";

import { useState } from "react";
import { type Applicant, transcriptReadability } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton } from "@/components/board/field";
import { TranscriptLabel } from "@/components/transcript";
import { cn } from "@/lib/utils";

function duration(seconds: number | null): string {
  if (seconds === null) return "";
  const s = Math.round(seconds);
  return ` (${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")})`;
}

// The URL is signed for five minutes, so it is fetched when someone presses
// play rather than for every row up front.
function Listen({ applicationId, seconds }: { applicationId: string; seconds: number | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (url) return <audio controls autoPlay src={url} className="h-9 w-full max-w-xs" />;
  return (
    <div className="grid gap-1">
      <BoardButton
        variant="quiet"
        className="min-h-9 justify-self-start px-3"
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          setError(null);
          try {
            setUrl((await apiClient.getIntroAudio(applicationId)).url);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't load the recording");
          } finally {
            setLoading(false);
          }
        }}
      >
        {loading ? "Loading" : `Listen${duration(seconds)}`}
      </BoardButton>
      {error && <span className="type-meta text-closing-lamp">{error}</span>}
    </div>
  );
}

// What an employer sees of a voice intro. The recording is the record; the
// transcript is a machine's guess at it, so it is labelled every time, set
// aside behind the audio when the guess looks poor, and withheld when it came
// out in a script nobody on the team reads.
export function IntroCell({
  applicationId,
  intro,
  readsLanguages,
}: {
  applicationId: string;
  intro: Applicant["intro"];
  readsLanguages: string[];
}) {
  if (!intro) return <span className="type-meta text-housing-muted">No intro</span>;
  const listen = <Listen applicationId={applicationId} seconds={intro.durationSeconds} />;

  if (intro.status !== "DONE" || !intro.transcript) {
    return (
      <div className="grid gap-1.5">
        <span className="type-meta text-housing-muted">
          {intro.status === "FAILED" ? (intro.error ?? "No transcript") : "Transcribing"}
        </span>
        {listen}
      </div>
    );
  }

  const readability = transcriptReadability(intro.transcript, readsLanguages);
  const label = (
    <TranscriptLabel language={intro.language} languageProbability={intro.languageProbability} className="text-housing-muted" />
  );

  if (!readability.readable) {
    return (
      <div className="grid gap-1.5">
        {listen}
        {label}
        <p className="type-meta">
          The transcript came out in {readability.script} script, which your team hasn&apos;t said it reads. Listen
          instead.
        </p>
      </div>
    );
  }

  if (intro.confidence === "low") {
    return (
      <div className="grid gap-1.5">
        {listen}
        <details>
          <summary className="type-meta cursor-pointer text-housing-muted">
            Transcript hidden: the recording was hard to make out, so it is likely to be wrong
          </summary>
          <div className="mt-1.5 grid gap-1">
            {label}
            <p className="type-body text-housing-muted">{intro.transcript}</p>
          </div>
        </details>
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      {label}
      <Preview text={intro.transcript} />
      {listen}
    </div>
  );
}

function Preview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className={cn("type-body text-left", !open && "line-clamp-2")}
    >
      {text}
    </button>
  );
}
