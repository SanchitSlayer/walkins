"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { type BoardState, stateColor } from "./board-state";

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
  const padded = length ? (align === "right" ? value.padStart(length) : value.padEnd(length)) : value;
  const style = {
    ...(tone ? { "--flap-color": stateColor(tone, "housing") } : {}),
    ...(cellWidth ? { "--flap-w": `${cellWidth}em` } : {}),
  } as CSSProperties;

  return (
    <span className={cn("inline-block", className)}>
      <span className="sr-only">{srValue ?? value}</span>
      <span className="flap" aria-hidden style={style}>
        {Array.from(padded).map((char, index) => (
          <FlapCell key={index} char={char === " " ? " " : char} delayMs={index * staggerMs} />
        ))}
      </span>
    </span>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

// Over a day away, seconds are noise and a board ticking every second draws
// the eye for nothing, so it counts in minutes until the last day.
function countdownText(seconds: number): { flap: string; spoken: string } {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return {
      flap: `${days}d ${pad(hours)}:${pad(minutes)}`,
      spoken: `${days} ${days === 1 ? "day" : "days"}, ${hours} hours and ${minutes} minutes`,
    };
  }
  return {
    flap: `${pad(hours)}:${pad(minutes)}:${pad(seconds % 60)}`,
    spoken: `${hours} hours and ${minutes} minutes`,
  };
}

export function Countdown({ startsAt, endsAt, className }: { startsAt: string; endsAt: string; className?: string }) {
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
  const label = started ? "Doors close in" : "Starts in";
  // The server has no clock worth trusting for a live count, so the first
  // render is a blank board that the browser fills in.
  const text = now === null ? { flap: "--:--:--", spoken: "" } : countdownText(Math.floor(((started ? end : start) - now) / 1000));

  return (
    <div className={cn("grid content-start gap-2", className)}>
      <span className="type-meta text-housing-muted">{label}</span>
      <FlapDisplay value={text.flap} srValue={text.spoken} className="text-[2rem]" cellWidth={0.62} staggerMs={0} />
    </div>
  );
}
