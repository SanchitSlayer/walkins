"use client";

import { useCallback, useEffect, useState } from "react";
import { type AdminDrive, dayLabel, formatTime } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton } from "@/components/board/field";

export default function DriveModerationPage() {
  const [drives, setDrives] = useState<AdminDrive[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setDrives(await apiClient.adminDrives()), []);
  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Couldn't load drives"));
  }, [load]);

  async function moderate(drive: AdminDrive, decision: "approve" | "reject") {
    let reason: string | undefined;
    if (decision === "reject") {
      const given = prompt(`Send "${drive.roleTitle}" back to ${drive.companyName}? They see your reason on the drive.`);
      if (given === null) return;
      reason = given.trim() || undefined;
    } else if (!confirm(`Put "${drive.roleTitle}" by ${drive.companyName} live? Candidates will see it and be alerted.`)) {
      return;
    }
    setBusy(drive.id);
    setError(null);
    try {
      await apiClient.adminModerateDrive(drive.id, { decision, reason });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(null);
    }
  }

  const now = new Date();
  const pending = drives?.filter((d) => d.status === "PENDING") ?? [];
  const live = drives?.filter((d) => d.status === "LIVE") ?? [];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="type-h2">Drive moderation</h1>
        <p className="type-meta mt-1 text-housing-muted">
          Approving is how a drive goes live. It needs a verified company with at least the cost of one check-in in its
          balance; anything blocking it is listed on the drive.
        </p>
      </div>
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      {!drives ? (
        <p role="status" className="type-meta text-housing-muted">
          Loading drives
        </p>
      ) : (
        <>
          <section className="grid gap-3">
            <h2 className="type-h3">Waiting for review ({pending.length})</h2>
            {pending.length === 0 && <p className="type-body text-housing-muted">Nothing waiting.</p>}
            <ul className="grid gap-3">
              {pending.map((d) => (
                <li key={d.id} className="grid gap-2 border border-housing-rule p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="type-body">
                      {d.roleTitle} <span className="text-housing-muted">at {d.companyName}</span>
                    </p>
                    <p className="type-meta text-housing-muted">
                      {dayLabel(new Date(d.startsAt), now)}, {formatTime(d.startsAt)}–{formatTime(d.endsAt)} · {d.capacity} seats
                    </p>
                  </div>
                  <p className="type-meta text-housing-muted">
                    {d.venueAddress}, {d.cityName}
                  </p>
                  {d.blockers.length > 0 && (
                    <ul className="type-meta grid gap-1 border-l-4 border-closing-lamp pl-3">
                      {d.blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <BoardButton className="min-h-9 px-3" disabled={busy === d.id || d.blockers.length > 0} onClick={() => moderate(d, "approve")}>
                      Approve and go live
                    </BoardButton>
                    <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy === d.id} onClick={() => moderate(d, "reject")}>
                      Send back
                    </BoardButton>
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section className="grid gap-2">
            <h2 className="type-h3">Live ({live.length})</h2>
            <ul className="type-meta grid">
              {live.map((d) => (
                <li key={d.id} className="border-b border-housing-line py-2">
                  {d.roleTitle} <span className="text-housing-muted">at {d.companyName} · {dayLabel(new Date(d.startsAt), now)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
