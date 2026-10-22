"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CHECK_IN_OPENS_BEFORE_START_MS, type MyApplication, type MyApplications } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { isNetworkError, loadPass, savePass } from "@/lib/offline";
import { useRequireRole } from "@/lib/use-require-role";
import { BoardButton, boardButtonClass } from "@/components/board/field";
import { Masthead } from "@/components/board/masthead";
import { Slab } from "@/components/board/slab";
import { NeverPay } from "@/components/never-pay";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";


function useOutcome() {
  const t = useTranslations("myDrives.outcome");
  return (application: MyApplication) => (application.checkIn && !application.checkIn.isValid ? t("awaitingConfirmation") : t(application.state));
}

function UpcomingPass({
  application,
  now,
  onRelease,
  releasing,
  savedAt,
}: {
  application: MyApplication;
  now: Date;
  onRelease: () => void;
  releasing: boolean;
  savedAt: string | null;
}) {
  const t = useTranslations("myDrives");
  const outcome = useOutcome();
  const { dayLabel, formatTime, formatWhen } = useFormat();
  const { drive } = application;
  const when = formatWhen(drive.startsAt, drive.endsAt, now);
  const was = drive.rescheduledFrom ? formatWhen(drive.rescheduledFrom.startsAt, drive.rescheduledFrom.endsAt, now) : null;
  const checkInOpen = now.getTime() >= new Date(drive.startsAt).getTime() - CHECK_IN_OPENS_BEFORE_START_MS;
  const booked = application.state === "CONFIRMED";
  const paused = drive.status === "SUSPENDED";
  const cancelled = drive.status === "CANCELLED";

  return (
    <Slab depth="md" state={paused ? "suspended" : cancelled ? "cancelled" : booked ? "live" : undefined} className="grid w-full gap-4">
      <div>
        <h3 className="type-h3">{t("roleAt", { role: drive.roleTitle, company: drive.companyName })}</h3>
        <p className="type-meta text-ink-muted">{drive.venueAddress}</p>
      </div>
      {was && (
        <p className="type-meta border-l-4 border-filling-lamp pl-3">{t("moved", { day: was.day, time: was.time })}</p>
      )}
      {/* A saved copy can't know about a change made since. A drive that
          has moved once is the one most likely to move again, so its time
          is shown with that said loudly rather than with false confidence. */}
      {savedAt && was && (
        <p role="alert" className="type-body border-l-4 border-closing-ink pl-3">
          {t("movedOffline", { day: dayLabel(new Date(savedAt), now), time: formatTime(savedAt) })}
        </p>
      )}
      {(paused || cancelled) && (
        <p role="status" className="type-body border-l-4 border-closing-ink pl-3">
          {paused ? t("paused") : t("cancelled")}
        </p>
      )}
      <dl className="grid gap-1">
        <div className="flex flex-wrap gap-x-2">
          <dt className="type-meta text-ink-muted">{t("drive")}</dt>
          <dd className="type-board-md">
            <span className="whitespace-nowrap">{when.day}</span>, <span className="whitespace-nowrap">{when.time}</span>
          </dd>
        </div>
        {application.slotStartsAt && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="type-meta text-ink-muted">{t("yourSlot")}</dt>
            <dd className="type-board-md">{formatTime(application.slotStartsAt)}</dd>
          </div>
        )}
        <div className="flex flex-wrap gap-x-2">
          <dt className="type-meta text-ink-muted">{t("status")}</dt>
          <dd className="type-meta">{outcome(application)}</dd>
        </div>
        {application.screenedOutReason && (
          <div className="flex flex-wrap gap-x-2">
            <dt className="type-meta text-ink-muted">{t("asksFor")}</dt>
            <dd className="type-meta">{application.screenedOutReason}</dd>
          </div>
        )}
      </dl>
      {(application.state === "SCREENED_OUT" || application.state === "REJECTED") && (
        <p className="type-meta text-ink-muted">{t("noSeatHeld")}</p>
      )}
      <div className="flex flex-wrap gap-3">
        {booked && checkInOpen && drive.status === "LIVE" && (
          <Link href="/checkin" className={boardButtonClass("stock")}>
            {t("checkIn")}
          </Link>
        )}
        <Link href={`/drives/${drive.id}`} className={boardButtonClass("stock", "quiet")}>
          {t("details")}
        </Link>
        {booked && (
          <BoardButton surface="stock" variant="quiet" onClick={onRelease} disabled={releasing}>
            {releasing ? t("releasing") : t("release")}
          </BoardButton>
        )}
      </div>
    </Slab>
  );
}

export default function MyDrivesPage() {
  const t = useTranslations("myDrives");
  const errorText = useErrorText();
  const outcome = useOutcome();
  const { dayLabel, formatTime, formatWhen } = useFormat();
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
        setError(errorText(err, "myDrives.loadFailed"));
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
    if (!confirm(t("releaseConfirm"))) return;
    setReleasingId(id);
    setError(null);
    try {
      await apiClient.releaseApplication(id);
      await load();
    } catch (err) {
      setError(errorText(err, "myDrives.releaseFailed"));
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
        <h1 className="type-h1">{t("heading")}</h1>

        <NeverPay />

        {savedAt && (
          <p role="status" className="type-h3 border-l-4 border-pending-lamp bg-housing-raised p-4">
            {t("offline", { day: dayLabel(new Date(savedAt), now), time: formatTime(savedAt) })}
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
              {t("comingUp")}
            </h2>
            {upcoming.length === 0 ? (
              <p className="type-body text-housing-muted">
                {t.rich("nothingBooked", {
                  link: (chunks) => (
                    <Link href="/" className="text-stock underline underline-offset-4">
                      {chunks}
                    </Link>
                  ),
                })}
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
                      savedAt={savedAt}
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
              {t("past")}
            </h2>
            <ul className="border-t border-housing-line">
              {past.map((application) => {
                const when = formatWhen(application.drive.startsAt, application.drive.endsAt, now);
                return (
                  <li key={application.id} className="grid gap-1 border-b border-housing-line py-3 sm:grid-cols-[1fr_auto] sm:gap-4">
                    <Link href={`/drives/${application.drive.id}`} className="type-body underline-offset-4 hover:underline">
                      {t("roleAt", { role: application.drive.roleTitle, company: application.drive.companyName })}
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
