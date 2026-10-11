"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { type BoardState, stateColor } from "./board-state";
import { useTranslations } from "next-intl";

const FLAP_MS = 140;

function FlapCell({ char, delayMs }: { char: string; delayMs: number }) {
  const previous = useRef(char);
  const flips = useRef(0);
  const [flip, setFlip] = useState<{ from: string; to: string; id: number } | null>(null);

  useEffect(() => {
    const from = previous.current;
    previous.current = char;
    if (from === char) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setFlip(null);
      return;
    }
    flips.current += 1;
    setFlip({ from, to: char, id: flips.current });
    const settle = setTimeout(() => setFlip(null), delayMs + FLAP_MS * 2 + 20);
    return () => clearTimeout(settle);
  }, [char, delayMs]);

  const top = flip ? flip.to : char;
  const bottom = flip ? flip.from : char;

  return (
    <span className="flap-cell" style={{ "--flap-delay": `${delayMs}ms`, "--flap-ms": `${FLAP_MS}ms` } as CSSProperties}>
      <span className="flap-half flap-top">
        <span className="flap-glyph">{top}</span>
      </span>
      <span className="flap-half flap-bottom">
        <span className="flap-glyph">{bottom}</span>
      </span>
      {flip && (
        <>
          <span key={`f${flip.id}`} className="flap-leaf flap-leaf-front">
            <span className="flap-glyph">{flip.from}</span>
          </span>
          <span key={`b${flip.id}`} className="flap-leaf flap-leaf-back">
            <span className="flap-glyph">{flip.to}</span>
          </span>
        </>
      )}
    </span>
  );
}

// One cell per character as a reader sees it. Splitting by code point would
// give a Devanagari vowel sign or nasal mark (ि, ँ) a flap of its own, where
// it renders as a dotted circle: हूँ is three code points and one syllable.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s) => s.segment);
}

export function FlapDisplay({
  value,
  length,
  align = "left",
  tone,
  cellWidth,
  staggerMs = 35,
  srValue,
  className,
}: {
  value: string;
  srValue?: string;
  length?: number;
  align?: "left" | "right";
  tone?: BoardState;
  cellWidth?: number;
  staggerMs?: number;
  className?: string;
}) {
  const glyphs = graphemes(value);
  const padding = length ? Array<string>(Math.max(0, length - glyphs.length)).fill(" ") : [];
  const cells = align === "right" ? [...padding, ...glyphs] : [...glyphs, ...padding];
  const style = {
    ...(tone ? { "--flap-color": stateColor(tone, "housing") } : {}),
    ...(cellWidth ? { "--flap-w": `${cellWidth}em` } : {}),
  } as CSSProperties;

  return (
    <span className={cn("inline-block", className)}>
      <span className="sr-only">{srValue ?? value}</span>
      <span className="flap" aria-hidden style={style}>
        {cells.map((char, index) => (
          <FlapCell key={index} char={char === " " ? " " : char} delayMs={index * staggerMs} />
        ))}
      </span>
    </span>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

// Over a day away, seconds are noise and a board ticking every second draws
// the eye for nothing, so it counts in minutes until the last day.
function countdownText(seconds: number, t: ReturnType<typeof useTranslations<"board.countdown">>): { flap: string; spoken: string } {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return {
      flap: t("daysFlap", { days, clock: `${pad(hours)}:${pad(minutes)}` }),
      spoken: t("daysSpoken", { days, hours, minutes }),
    };
  }
  return {
    flap: `${pad(hours)}:${pad(minutes)}:${pad(seconds % 60)}`,
    spoken: t("hoursSpoken", { hours, minutes }),
  };
}

export function Countdown({ startsAt, endsAt, className }: { startsAt: string; endsAt: string; className?: string }) {
  const t = useTranslations("board.countdown");
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (now !== null && now >= end) return null;

  const started = now !== null && now >= start;
  const label = started ? t("closesIn") : t("startsIn");
  // The server has no clock worth trusting for a live count, so the first
  // render is a blank board that the browser fills in.
  const text = now === null ? { flap: "--:--:--", spoken: "" } : countdownText(Math.floor(((started ? end : start) - now) / 1000), t);

  return (
    <div className={cn("grid content-start gap-2", className)}>
      <span className="type-meta text-housing-muted">{label}</span>
      <FlapDisplay value={text.flap} srValue={text.spoken} className="text-[2rem]" cellWidth={0.62} staggerMs={0} />
    </div>
  );
}
