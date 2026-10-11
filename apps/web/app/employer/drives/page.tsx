"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { EmployerDriveRow } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { deriveBoardState, StatusMark } from "@/components/board/board-state";
import { BoardButton, boardButtonClass } from "@/components/board/field";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";

function Seats({ capacity, booked }: { capacity: number; booked: number }) {
  const t = useTranslations("employerDrives");
  return (
    <span className="grid gap-1">
      <span className="type-board-sm whitespace-nowrap">{t("booked", { booked, capacity })}</span>
      <span aria-hidden className="h-1 w-full max-w-28 bg-housing-line">
        <span className="block h-full bg-stock" style={{ width: `${capacity ? Math.min(100, (booked / capacity) * 100) : 0}%` }} />
      </span>
    </span>
  );
}

export default function EmployerDrivesPage() {
  const t = useTranslations("employerDrives");
  const errorText = useErrorText();
  const { formatWhen } = useFormat();
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
      setError(errorText(err, "employerDrives.loadFailed"));
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
        <h1 className="type-h2">{t("heading")}</h1>
        <Link href="/employer/drives/new" className={boardButtonClass()}>
          {t("new")}
        </Link>
      </div>

      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      <p role="status" className="type-meta text-housing-muted">
        {loading ? t("loading") : drives.length === 0 && !error ? t("empty") : ""}
      </p>

      {drives.length > 0 && (
        <div className="border-t border-housing-line">
          <div
            aria-hidden
            className="type-meta hidden grid-cols-[minmax(0,1fr)_13rem_9rem_9rem] gap-4 border-b border-housing-line py-2 text-housing-muted md:grid"
          >
            <span>{t("roleVenue")}</span>
            <span>{t("when")}</span>
            <span>{t("seats")}</span>
            <span>{t("status")}</span>
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
                      <span className="type-meta block text-filling-lamp">{t("approximatePin")}</span>
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
            {t("previous")}
          </BoardButton>
          <BoardButton
            variant="quiet"
            disabled={!nextCursor || loading}
            onClick={() => nextCursor && setCursorStack((stack) => [...stack, nextCursor])}
          >
            {t("next")}
          </BoardButton>
        </div>
      )}
    </div>
  );
}
