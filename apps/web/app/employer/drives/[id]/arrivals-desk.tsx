"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { type ApplicationState, formatTime, type LiveBoard } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { useLiveFeed } from "@/lib/use-live-feed";
import { BoardButton, boardButtonClass } from "@/components/board/field";

type Arrival = LiveBoard["arrivals"][number];

const METHOD: Record<Arrival["method"], string> = {
  SCAN: "Scanned",
  WALK_IN: "Walk-in",
  MANUAL: "Marked present",
};

const STATE: Partial<Record<ApplicationState, string>> = {
  CHECKED_IN: "Arrived",
  INTERVIEWED: "Interviewed",
  HIRED: "Hired",
  REJECTED: "Not selected",
  NO_SHOW: "Marked absent",
  CONFIRMED: "Booked",
};

// The moves the transition table allows an employer from each state.
const NEXT: Partial<Record<ApplicationState, { to: "INTERVIEWED" | "HIRED" | "REJECTED"; label: string }[]>> = {
  CHECKED_IN: [
    { to: "INTERVIEWED", label: "Interviewed" },
    { to: "REJECTED", label: "Not selected" },
  ],
  INTERVIEWED: [
    { to: "HIRED", label: "Hire" },
    { to: "REJECTED", label: "Not selected" },
  ],
};

function Row({ children }: { children: ReactNode }) {
  return (
    <li className="grid gap-2 border-b border-housing-line py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">{children}</li>
  );
}

// The employer's side of the arrivals board: everything the public screen
// leaves out (full names, why a check-in was flagged) and every judgement
// about a person, made here rather than on a screen the queue can see.
export function ArrivalsDesk({ driveId }: { driveId: string }) {
  const { data: desk, refresh } = useLiveFeed(driveId, "desk", () => apiClient.getLiveDesk(driveId));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(key: string, action: () => Promise<unknown>, question?: string) {
    if (question && !confirm(question)) return;
    setBusy(key);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(null);
    }
  }

  if (!desk) return null;
  const flagged = desk.arrivals.filter((a) => !a.isValid);

  return (
    <section aria-labelledby="desk-heading" className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="desk-heading" className="type-h3">
          Arrivals desk
        </h2>
        <Link href={`/employer/drives/${driveId}/live`} className={boardButtonClass("housing", "quiet")}>
          Open arrivals board
        </Link>
      </div>
      <p className="type-board-sm text-housing-muted">
        {desk.counts.checkedIn} booked arrived · {desk.counts.walkIns} walk-ins · {desk.awaiting.length} still expected ·{" "}
        {desk.counts.hired} hired
      </p>

      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}

      {flagged.length > 0 && (
        <div className="grid gap-2">
          <h3 className="type-meta text-filling-lamp">Needs your confirmation ({flagged.length})</h3>
          <ul className="border-t border-housing-line">
            {flagged.map((a) => (
              <Row key={a.checkInId}>
                <div>
                  <p className="type-body">{a.name}</p>
                  <p className="type-meta text-housing-muted">
                    {METHOD[a.method]} at {formatTime(a.scannedAt)}. {a.flagReason}
                  </p>
                </div>
                <BoardButton onClick={() => act(a.checkInId, () => apiClient.confirmCheckIn(a.checkInId))} disabled={busy !== null}>
                  {busy === a.checkInId ? "Confirming" : "Confirm"}
                </BoardButton>
              </Row>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-2">
        <h3 className="type-meta text-housing-muted">Still expected ({desk.awaiting.length})</h3>
        {desk.awaiting.length === 0 ? (
          <p className="type-meta text-housing-muted">Everyone booked has arrived.</p>
        ) : (
          <ul className="border-t border-housing-line">
            {desk.awaiting.map((a) => (
              <Row key={a.applicationId}>
                <div>
                  <p className="type-body">{a.name}</p>
                  <p className="type-meta text-housing-muted">
                    {a.slotStartsAt ? `Slot ${formatTime(a.slotStartsAt)}` : "No slot"} · {STATE[a.state]}
                  </p>
                </div>
                <BoardButton
                  variant="quiet"
                  disabled={busy !== null}
                  onClick={() =>
                    act(a.applicationId, () => apiClient.markPresent(a.applicationId), `Mark ${a.name} as present without a scan?`)
                  }
                >
                  {busy === a.applicationId ? "Marking" : "Mark present"}
                </BoardButton>
              </Row>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-2">
        <h3 className="type-meta text-housing-muted">Arrived ({desk.arrivals.length})</h3>
        {desk.arrivals.length === 0 ? (
          <p className="type-meta text-housing-muted">Nobody has checked in yet.</p>
        ) : (
          <ul className="border-t border-housing-line">
            {desk.arrivals.map((a) => (
              <Row key={a.checkInId}>
                <div>
                  <p className="type-body">{a.name}</p>
                  <p className="type-meta text-housing-muted">
                    {METHOD[a.method]} at {formatTime(a.scannedAt)}
                    {a.slotStartsAt ? ` · slot ${formatTime(a.slotStartsAt)}` : ""} · {STATE[a.state] ?? a.state}
                    {a.isValid ? "" : " · awaiting confirmation"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(NEXT[a.state] ?? []).map(({ to, label }) => (
                    <BoardButton
                      key={to}
                      variant={to === "REJECTED" ? "quiet" : "primary"}
                      disabled={busy !== null}
                      onClick={() =>
                        act(
                          `${a.applicationId}:${to}`,
                          () => apiClient.updateApplicationState(a.applicationId, to),
                          to === "INTERVIEWED" ? undefined : `${label}: ${a.name}? This can't be undone.`,
                        )
                      }
                    >
                      {busy === `${a.applicationId}:${to}` ? "Saving" : label}
                    </BoardButton>
                  ))}
                </div>
              </Row>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
