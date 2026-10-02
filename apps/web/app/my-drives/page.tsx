"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { type ApplicationState, formatTime, formatWhen, type MyApplication, type MyApplications } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { isNetworkError, loadPass, savePass } from "@/lib/offline";
import { useRequireRole } from "@/lib/use-require-role";
import { BoardButton, boardButtonClass } from "@/components/board/field";
import { Masthead } from "@/components/board/masthead";
import { Slab } from "@/components/board/slab";

const CHECK_IN_OPENS_MS = 60 * 60_000;

const OUTCOME: Record<ApplicationState, string> = {
  INTERESTED: "Saved",
  CONFIRMED: "Booked",
  CHECKED_IN: "Checked in",
  INTERVIEWED: "Interviewed",
  HIRED: "Hired",
  REJECTED: "Not selected",
  NO_SHOW: "Marked absent",
  WITHDRAWN: "Seat released",
};

function outcome(application: MyApplication): string {
  if (application.checkIn && !application.checkIn.isValid) return "Checked in, waiting for the employer to confirm";
  return OUTCOME[application.state];
}

function UpcomingPass({
  application,
  now,
  onRelease,
  releasing,
}: {
  application: MyApplication;
  now: Date;
  onRelease: () => void;
  releasing: boolean;
}) {
  const { drive } = application;
  const when = formatWhen(drive.startsAt, drive.endsAt, now);
  const checkInOpen = now.getTime() >= new Date(drive.startsAt).getTime() - CHECK_IN_OPENS_MS;
  const booked = application.state === "CONFIRMED";

  return (
    <Slab depth="md" state={booked ? "live" : undefined} className="grid w-full gap-4">
      <div>
        <h3 className="type-h3">
          {drive.roleTitle} at {drive.companyName}
        </h3>
        <p className="type-meta text-ink-muted">{drive.venueAddress}</p>
      </div>
      <dl className="grid gap-1">
        <div className="flex flex-wrap gap-x-2">
          <dt className="type-meta text-ink-muted">Drive</dt>
          <dd className="type-board-md">
            <span className="whitespace-nowrap">{when.day}</span>, <span className="whitespace-nowrap">{when.time}</span>
          </dd>
        </div>
        {application.slotStartsAt && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="type-meta text-ink-muted">Your slot</dt>
            <dd className="type-board-md">{formatTime(application.slotStartsAt)}</dd>
          </div>
        )}
        <div className="flex flex-wrap gap-x-2">
          <dt className="type-meta text-ink-muted">Status</dt>
          <dd className="type-meta">{outcome(application)}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-3">
        {booked && checkInOpen && (
          <Link href="/checkin" className={boardButtonClass("stock")}>
            Check in
          </Link>
        )}
        <Link href={`/drives/${drive.id}`} className={boardButtonClass("stock", "quiet")}>
          Drive details
        </Link>
        {booked && (
          <BoardButton surface="stock" variant="quiet" onClick={onRelease} disabled={releasing}>
            {releasing ? "Releasing" : "Release my seat"}
          </BoardButton>
        )}
      </div>
    </Slab>
  );
}

export default function MyDrivesPage() {
  const ready = useRequireRole("CANDIDATE");
  const [applications, setApplications] = useState<MyApplications | null>(null);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  // This page is the candidate's pass: each successful load is kept on the
  // phone, and with no signal the kept copy is shown instead.
  const load = useCallback(async () => {
    try {
      const fresh = await apiClient.listMyApplications();
      savePass(fresh);
      setApplications(fresh);
      setSavedAt(null);
    } catch (err) {
      const pass = isNetworkError(err) ? loadPass() : null;
      if (pass) {
        setApplications(pass.applications);
        setSavedAt(pass.savedAt);
      } else {
        setError(err instanceof Error ? err.message : "Couldn't load your drives");
      }
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    load();
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, [ready, load]);

  async function release(id: string) {
    if (!confirm("Release your seat? Someone else can then book it.")) return;
    setReleasingId(id);
    setError(null);
    try {
      await apiClient.releaseApplication(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't release your seat");
    } finally {
      setReleasingId(null);
    }
  }

  const upcoming = applications?.upcoming.filter((a) => a.state !== "WITHDRAWN") ?? [];
  const past = applications?.past ?? [];

  return (
    <div className="min-h-screen bg-housing text-stock">
      <Masthead />
      <main className="mx-auto grid max-w-3xl gap-10 px-4 py-8 sm:px-6">
        <h1 className="type-h1">Your drives</h1>

        {savedAt && (
          <p className="type-meta border-l-4 border-pending-lamp bg-housing-raised p-4">
            You&apos;re offline. Showing your drives as saved at {formatTime(savedAt)}; booking changes need signal.
          </p>
        )}

        {error && (
          <p role="alert" className="type-meta text-closing-lamp">
            {error}
          </p>
        )}

        {applications && (
          <section aria-labelledby="upcoming-heading" className="grid gap-6">
            <h2 id="upcoming-heading" className="type-h3">
              Coming up
            </h2>
            {upcoming.length === 0 ? (
              <p className="type-body text-housing-muted">
                Nothing booked yet.{" "}
                <Link href="/" className="text-stock underline underline-offset-4">
                  Find walk-ins near you
                </Link>
                .
              </p>
            ) : (
              <ul className="grid gap-6">
                {upcoming.map((application) => (
                  <li key={application.id}>
                    <UpcomingPass
                      application={application}
                      now={now}
                      onRelease={() => release(application.id)}
                      releasing={releasingId === application.id}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {past.length > 0 && (
          <section aria-labelledby="past-heading" className="grid gap-3">
            <h2 id="past-heading" className="type-h3">
              Past
            </h2>
            <ul className="border-t border-housing-line">
              {past.map((application) => {
                const when = formatWhen(application.drive.startsAt, application.drive.endsAt, now);
                return (
                  <li key={application.id} className="grid gap-1 border-b border-housing-line py-3 sm:grid-cols-[1fr_auto] sm:gap-4">
                    <Link href={`/drives/${application.drive.id}`} className="type-body underline-offset-4 hover:underline">
                      {application.drive.roleTitle} at {application.drive.companyName}
                    </Link>
                    <span className="type-board-sm text-housing-muted">
                      {when.day} · {outcome(application)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
