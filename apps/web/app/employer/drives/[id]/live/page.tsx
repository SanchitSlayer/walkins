"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { LiveDisplay } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { useLiveFeed } from "@/lib/use-live-feed";
import { cn } from "@/lib/utils";
import { BoardButton } from "@/components/board/field";
import { FlapDisplay, graphemes } from "@/components/board/flap-display";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";

const ROWS = 12;
const NAME_CELLS = 16;

const COUNTS: (keyof LiveDisplay["counts"])[] = ["alerted", "confirmed", "checkedIn", "walkIns", "hired"];

// Counts characters as a reader sees them, so a name is never cut between a
// Devanagari letter and its vowel sign.
function fit(text: string, length: number) {
  const glyphs = graphemes(text);
  return glyphs.length > length ? `${glyphs.slice(0, length - 1).join("")}…` : text;
}

// The arrivals board: built to go on a screen facing the queue, so it shows
// only the public projection (short names, slot times, counts). Confirming
// flags and marking people present happen on the drive page, not here.
//
// The rows are positional, like a real departures board: when someone
// arrives every row takes the one above it, so each cell flips to its new
// value and the newest arrival lands at the top.
export default function ArrivalsBoardPage() {
  const t = useTranslations("liveBoard");
  const { formatTime, formatWhen } = useFormat();
  const { id } = useParams<{ id: string }>();
  const { data: board, connected } = useLiveFeed(id, "board", () => apiClient.getLiveDisplay(id));
  const [clock, setClock] = useState<Date | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    setClock(new Date());
    const tick = setInterval(() => setClock(new Date()), 5_000);
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      clearInterval(tick);
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, []);

  if (!board) {
    return <p className="type-meta text-housing-muted">{t("loading")}</p>;
  }

  const when = formatWhen(board.startsAt, board.endsAt, clock ?? new Date(board.startsAt));
  const rows = Array.from({ length: ROWS }, (_, index) => board.arrivals[index] ?? null);

  return (
    <div className="grid gap-8 bg-housing pb-8 text-stock">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-housing-line pb-6">
        <div className="grid gap-1">
          <p className="type-board-md text-housing-muted">{t("arrivals")}</p>
          <h1 className="type-display">
            {t.rich("title", {
              role: board.roleTitle,
              company: board.companyName,
              quiet: (chunks) => <span className="text-housing-muted">{chunks}</span>,
            })}
          </h1>
          <p className="type-board-md text-housing-muted">{t("where", { venue: board.venueAddress, day: when.day, time: when.time })}</p>
        </div>
        <div className="grid justify-items-end gap-2">
          <FlapDisplay
            value={clock ? formatTime(clock.toISOString()) : "--:--"}
            className="text-[clamp(2rem,5vw,4rem)]"
            cellWidth={0.62}
            staggerMs={0}
          />
          <p className="type-meta flex items-center gap-2 text-housing-muted">
            <span
              aria-hidden
              className={cn("inline-block h-2.5 w-2.5 rounded-full", connected ? "bg-live-lamp" : "border-2 border-housing-rule")}
            />
            {connected ? t("live") : t("reconnecting")}
          </p>
        </div>
      </header>

      <section aria-label={t("counts")} className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
        {COUNTS.map((key) => (
          <div key={key} className="grid gap-2 border-t border-housing-line pt-3">
            <span className="type-meta text-housing-muted">{t(`count.${key}`)}</span>
            <FlapDisplay
              value={String(board.counts[key])}
              length={3}
              align="right"
              className="text-[clamp(2.5rem,6vw,5rem)]"
              cellWidth={0.62}
            />
          </div>
        ))}
      </section>

      <section aria-labelledby="arrivals-heading" className="grid gap-3">
        <h2 id="arrivals-heading" className="type-h3">
          {t("latest")}
        </h2>
        <table className="w-full border-collapse">
          <thead>
            <tr className="type-meta text-left text-housing-muted">
              <th scope="col" className="pb-2 pr-4 font-normal">
                {t("arrived")}
              </th>
              <th scope="col" className="pb-2 pr-4 font-normal">
                {t("name")}
              </th>
              <th scope="col" className="hidden pb-2 font-normal sm:table-cell">
                {t("slot")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((arrival, index) => (
              <tr key={index} className="border-t border-housing-line">
                <td className="py-2 pr-4">
                  <FlapDisplay
                    value={arrival ? formatTime(arrival.scannedAt) : ""}
                    length={5}
                    className="text-[clamp(1.25rem,2.6vw,2rem)]"
                    cellWidth={0.62}
                  />
                </td>
                <td className="w-full py-2 pr-4">
                  <FlapDisplay
                    value={arrival ? fit(arrival.displayName, NAME_CELLS) : ""}
                    length={NAME_CELLS}
                    className="text-[clamp(1.25rem,2.6vw,2rem)]"
                    cellWidth={0.62}
                    staggerMs={20}
                  />
                </td>
                <td className="hidden py-2 sm:table-cell">
                  <FlapDisplay
                    value={arrival ? (arrival.slotStartsAt ? formatTime(arrival.slotStartsAt) : t("walkIn")) : ""}
                    length={7}
                    tone={arrival && !arrival.slotStartsAt ? "pending" : undefined}
                    className="text-[clamp(1.25rem,2.6vw,2rem)]"
                    cellWidth={0.62}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {board.arrivals.length === 0 && <p className="type-meta text-housing-muted">{t("none")}</p>}
      </section>

      {!fullscreen && (
        <div className="flex flex-wrap gap-3">
          <BoardButton onClick={() => document.documentElement.requestFullscreen()}>{t("fullScreen")}</BoardButton>
          <Link href={`/employer/drives/${id}`} className="type-meta self-center text-housing-muted underline-offset-4 hover:underline">
            {t("back")}
          </Link>
        </div>
      )}
    </div>
  );
}
