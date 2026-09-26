"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { EmployerDriveRow } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { formatWhen } from "@/lib/board-format";
import { deriveBoardState, StatusMark } from "@/components/board/board-state";
import { BoardButton, boardButtonClass } from "@/components/board/field";

function Seats({ capacity, booked }: { capacity: number; booked: number }) {
  return (
    <span className="grid gap-1">
      <span className="type-board-sm whitespace-nowrap">
        {booked} of {capacity} booked
      </span>
      <span aria-hidden className="h-1 w-full max-w-28 bg-housing-line">
        <span className="block h-full bg-stock" style={{ width: `${capacity ? Math.min(100, (booked / capacity) * 100) : 0}%` }} />
      </span>
    </span>
  );
}

export default function EmployerDrivesPage() {
  const [drives, setDrives] = useState<EmployerDriveRow[]>([]);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  const currentCursor = cursorStack[cursorStack.length - 1];

  const load = useCallback(async (cursor: string | undefined) => {
    setLoading(true);
    setError(null);
    try {
      const page = await apiClient.listMyDrives(cursor);
      setDrives(page.items);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load your drives");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(currentCursor);
  }, [load, currentCursor]);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="type-h2">Drives</h1>
        <Link href="/employer/drives/new" className={boardButtonClass()}>
          New drive
        </Link>
      </div>

      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      <p role="status" className="type-meta text-housing-muted">
        {loading ? "Loading drives" : drives.length === 0 && !error ? "No drives yet. Start with a new drive." : ""}
      </p>

      {drives.length > 0 && (
        <div className="border-t border-housing-line">
          <div
            aria-hidden
            className="type-meta hidden grid-cols-[minmax(0,1fr)_13rem_9rem_9rem] gap-4 border-b border-housing-line py-2 text-housing-muted md:grid"
          >
            <span>Role and venue</span>
            <span>When</span>
            <span>Seats</span>
            <span>Status</span>
          </div>
          <ul>
            {drives.map((drive) => {
              const state = deriveBoardState(drive, now);
              const when = formatWhen(drive.startsAt, drive.endsAt, now);
              return (
                <li
                  key={drive.id}
                  className="relative grid gap-2 border-b border-housing-line py-3 hover:bg-housing-raised md:grid-cols-[minmax(0,1fr)_13rem_9rem_9rem] md:items-center md:gap-4"
                >
                  <span className="min-w-0">
                    {/* The link covers the whole row, so the row is one target
                        without wrapping every cell in an anchor. */}
                    <Link href={`/employer/drives/${drive.id}`} className="type-body font-semibold after:absolute after:inset-0">
                      {drive.role.title}
                    </Link>
                    <span className="type-meta block truncate text-housing-muted">{drive.venueAddress}</span>
                    {drive.needsManualGeocode && (
                      <span className="type-meta block text-filling-lamp">Venue pin is approximate</span>
                    )}
                  </span>
                  <span className="type-board-sm">
                    <span className="whitespace-nowrap">{when.day}</span>
                    {" · "}
                    <span className="whitespace-nowrap">{when.time}</span>
                  </span>
                  <Seats capacity={drive.capacity} booked={drive.bookedCount} />
                  <StatusMark state={state} surface="housing" />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {(cursorStack.length > 1 || nextCursor) && (
        <div className="flex justify-between gap-3">
          <BoardButton
            variant="quiet"
            disabled={cursorStack.length <= 1 || loading}
            onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
          >
            Previous page
          </BoardButton>
          <BoardButton
            variant="quiet"
            disabled={!nextCursor || loading}
            onClick={() => nextCursor && setCursorStack((stack) => [...stack, nextCursor])}
          >
            Next page
          </BoardButton>
        </div>
      )}
    </div>
  );
}
