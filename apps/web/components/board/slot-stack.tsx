"use client";

import { useState } from "react";
import type { DriveSlot } from "@walkins/shared";
import { dayKey, dayLabel, formatSeats, formatTime } from "@/lib/board-format";
import { cn } from "@/lib/utils";

const MAX_TOKENS = 30;
const COLLAPSE_OVER = 8;
const COLLAPSED_COUNT = 6;

// One token per seat, so a booked seat reads as a token taken off the stack:
// open seats stand up with an edge, booked ones are the empty outline left
// behind. Very large slots are drawn at several seats per token, and the
// legend says so, rather than wrapping into a wall.
function Tokens({ capacity, booked, perToken, past }: { capacity: number; booked: number; perToken: number; past: boolean }) {
  const total = Math.ceil(capacity / perToken);
  const taken = Math.min(total, Math.round(booked / perToken));
  return (
    <span aria-hidden className={cn("flex flex-wrap gap-[3px] pt-0.5", past && "opacity-40")}>
      {Array.from({ length: total }, (_, index) =>
        index < total - taken ? (
          <span key={index} className="h-2.5 w-2.5 -translate-y-px bg-stock shadow-[0_2px_0_var(--stock-edge-deep)]" />
        ) : (
          <span key={index} className="h-2.5 w-2.5 border border-housing-rule" />
        ),
      )}
    </span>
  );
}

// dense is the operations desk's size: same tokens, smaller board type.
export function SlotStack({
  slots,
  now,
  dense = false,
  className,
}: {
  slots: DriveSlot[];
  now: Date;
  dense?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const perToken = Math.max(1, Math.ceil(Math.max(0, ...slots.map((s) => s.capacity)) / MAX_TOKENS));
  const collapsible = slots.length > COLLAPSE_OVER;

  // Collapsed, the list starts at the next slot still to come: slots already
  // under way are history to someone deciding when to turn up.
  const upcoming = slots.findIndex((s) => new Date(s.startsAt) > now);
  const firstUpcoming = upcoming === -1 ? slots.length : upcoming;
  const start = collapsible && !expanded ? Math.min(firstUpcoming, slots.length - COLLAPSED_COUNT) : 0;
  const shown = collapsible && !expanded ? slots.slice(start, start + COLLAPSED_COUNT) : slots;

  const days: { key: string; label: string; slots: DriveSlot[] }[] = [];
  for (const slot of shown) {
    const date = new Date(slot.startsAt);
    const key = dayKey(date);
    if (days.at(-1)?.key !== key) days.push({ key, label: dayLabel(date, now), slots: [] });
    days.at(-1)!.slots.push(slot);
  }

  return (
    <div className={className}>
      <p className="type-meta flex flex-wrap items-center gap-x-4 gap-y-1 text-housing-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 bg-stock shadow-[0_2px_0_var(--stock-edge-deep)]" />
          Open {perToken > 1 ? `(${perToken} seats each)` : "seat"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 border border-housing-rule" />
          Booked
        </span>
      </p>

      {days.map((day) => (
        <section key={day.key} className="mt-5">
          <h3 className="type-board-md text-housing-muted">{day.label}</h3>
          <ol className="mt-2 grid gap-3">
            {day.slots.map((slot) => {
              const past = new Date(slot.startsAt) <= now;
              return (
                <li
                  key={slot.id}
                  className={cn("grid items-start gap-x-3", dense ? "grid-cols-[3rem_1fr]" : "grid-cols-[4.75rem_1fr]")}
                >
                  <span className={cn(dense ? "type-board-md" : "type-board-lg leading-none", past && "text-housing-muted")}>
                    {formatTime(slot.startsAt)}
                  </span>
                  <span className="grid gap-1">
                    <Tokens capacity={slot.capacity} booked={slot.bookedCount} perToken={perToken} past={past} />
                    <span className="type-board-sm text-housing-muted">
                      {past ? "Under way or over" : formatSeats(slot.capacity, slot.bookedCount)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="type-meta mt-5 min-h-11 border border-housing-rule px-4 hover:bg-housing-raised"
        >
          {expanded ? "Show fewer slots" : `Show all ${slots.length} slots`}
        </button>
      )}
    </div>
  );
}
