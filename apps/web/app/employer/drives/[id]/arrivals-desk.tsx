"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { ApplicationState, Outcomes } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { useLiveFeed } from "@/lib/use-live-feed";
import { BoardButton, boardButtonClass, BoardInput } from "@/components/board/field";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";
import { useMembership } from "@/lib/membership";
import { usePersonName } from "@/components/person-name";
import { ReportCandidate } from "@/components/report-candidate";
import { MessageLink, useDriveThreads } from "@/components/message-link";

// The moves the transition table allows an employer from each state.
const NEXT: Partial<Record<ApplicationState, ("INTERVIEWED" | "HIRED" | "REJECTED")[]>> = {
  CHECKED_IN: ["INTERVIEWED", "REJECTED"],
  INTERVIEWED: ["HIRED", "REJECTED"],
};

// Asked on the desk, at the moment of hiring, because it is the one moment
// the employer certainly has the answer and the screen open. Optional:
// "not agreed yet" is a real answer, and the Outcomes page asks again.
function JoiningDate({ applicationId, outcomes, onSaved }: { applicationId: string; outcomes: Outcomes | null; onSaved: () => void }) {
  const t = useTranslations("outcomes");
  const errorText = useErrorText();
  const { formatDate } = useFormat();
  const row = outcomes?.rows.find((r) => r.applicationId === applicationId);
  const [day, setDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!row) return null;
  if (row.joiningDate) return <p className="type-meta text-housing-muted">{t("joiningOn", { day: formatDate(new Date(`${row.joiningDate}T12:00:00+05:30`)) })}</p>;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.recordOutcome(applicationId, { joiningDate: day });
      onSaved();
    } catch (err) {
      setError(errorText(err, "outcomes.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1">
        <span className="type-meta text-housing-muted">{t("whenStarting")}</span>
        <BoardInput type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-auto" />
      </label>
      <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy || !day} onClick={save}>
        {t("saveDate")}
      </BoardButton>
      {error && <span className="type-meta text-closing-lamp">{error}</span>}
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <li className="grid gap-2 border-b border-housing-line py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">{children}</li>
  );
}

// The employer's side of the arrivals board: everything the public screen
// leaves out (full names, why a check-in was flagged) and every judgement
// about a person, made here rather than on a screen the queue can see.
export function ArrivalsDesk({ driveId }: { driveId: string }) {
  const t = useTranslations("arrivals");
  const state = useTranslations("deskState");
  const errorText = useErrorText();
  const { formatTime } = useFormat();
  const runs = useMembership().can("runDrives");
  const personName = usePersonName();
  const threads = useDriveThreads(driveId);
  const [outcomes, setOutcomes] = useState<Outcomes | null>(null);
  const loadOutcomes = useCallback(() => apiClient.companyOutcomes(driveId).then(setOutcomes, () => {}), [driveId]);
  useEffect(() => {
    loadOutcomes();
  }, [loadOutcomes]);
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
      // A hire opens an outcome record, so the joining-date question appears.
      await loadOutcomes();
    } catch (err) {
      setError(errorText(err, "errors.generic"));
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
          {t("heading")}
        </h2>
        <div className="flex flex-wrap gap-3">
          <Link href={`/employer/drives/${driveId}/applicants`} className={boardButtonClass("housing", "quiet")}>
            {t("applicants")}
          </Link>
          <Link href={`/employer/drives/${driveId}/live`} className={boardButtonClass("housing", "quiet")}>
            {t("openBoard")}
          </Link>
        </div>
      </div>
      <p className="type-board-sm text-housing-muted">
        {t("counts", { arrived: desk.counts.checkedIn, walkIns: desk.counts.walkIns, expected: desk.awaiting.length, hired: desk.counts.hired })}
      </p>

      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}

      {flagged.length > 0 && (
        <div className="grid gap-2">
          <h3 className="type-meta text-filling-lamp">{t("needsConfirmation", { count: flagged.length })}</h3>
          <ul className="border-t border-housing-line">
            {flagged.map((a) => (
              <Row key={a.checkInId}>
                <div>
                  <p className="type-body">{a.name}</p>
                  <p className="type-meta text-housing-muted">
                    {t("flaggedLine", { method: a.method, time: formatTime(a.scannedAt), reason: a.flagReason ?? "" })}
                  </p>
                </div>
                {runs && (
                  <BoardButton onClick={() => act(a.checkInId, () => apiClient.confirmCheckIn(a.checkInId))} disabled={busy !== null}>
                    {busy === a.checkInId ? t("confirming") : t("confirm")}
                  </BoardButton>
                )}
              </Row>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-2">
        <h3 className="type-meta text-housing-muted">{t("expected", { count: desk.awaiting.length })}</h3>
        {desk.awaiting.length === 0 ? (
          <p className="type-meta text-housing-muted">{t("allArrived")}</p>
        ) : (
          <ul className="border-t border-housing-line">
            {desk.awaiting.map((a) => (
              <Row key={a.applicationId}>
                <div>
                  <p className="type-body">{a.name}</p>
                  <p className="type-meta text-housing-muted">
                    {a.slotStartsAt ? t("slot", { time: formatTime(a.slotStartsAt) }) : t("noSlot")} · {state(a.state)}
                  </p>
                  <MessageLink driveId={driveId} applicationId={a.applicationId} threads={threads} />
                </div>
                {runs && (
                  <BoardButton
                    variant="quiet"
                    disabled={busy !== null}
                    onClick={() =>
                      act(a.applicationId, () => apiClient.markPresent(a.applicationId), t("markPresentConfirm", { name: a.name }))
                    }
                  >
                    {busy === a.applicationId ? t("marking") : t("markPresent")}
                  </BoardButton>
                )}
              </Row>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-2">
        <h3 className="type-meta text-housing-muted">{t("arrived", { count: desk.arrivals.length })}</h3>
        {desk.arrivals.length === 0 ? (
          <p className="type-meta text-housing-muted">{t("nobodyYet")}</p>
        ) : (
          <ul className="border-t border-housing-line">
            {desk.arrivals.map((a) => (
              <Row key={a.checkInId}>
                <div>
                  <p className="type-body">{a.name}</p>
                  <p className="type-meta text-housing-muted">
                    {[
                      t("arrivedAt", { method: a.method, time: formatTime(a.scannedAt) }),
                      a.slotStartsAt ? t("slot", { time: formatTime(a.slotStartsAt) }) : null,
                      state(a.state),
                      a.isValid ? null : t("awaitingConfirmation"),
                      a.recordedBy ? t("markedBy", { name: personName(a.recordedBy) }) : null,
                      a.confirmedBy ? t("confirmedBy", { name: personName(a.confirmedBy) }) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <MessageLink driveId={driveId} applicationId={a.applicationId} threads={threads} />
                  {runs && a.state === "HIRED" && <JoiningDate applicationId={a.applicationId} outcomes={outcomes} onSaved={loadOutcomes} />}
                  <ReportCandidate applicationId={a.applicationId} name={a.name} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {(runs ? (NEXT[a.state] ?? []) : []).map((to) => (
                    <BoardButton
                      key={to}
                      variant={to === "REJECTED" ? "quiet" : "primary"}
                      disabled={busy !== null}
                      onClick={() =>
                        act(
                          `${a.applicationId}:${to}`,
                          () => apiClient.updateApplicationState(a.applicationId, to),
                          to === "INTERVIEWED" ? undefined : t("moveConfirm", { to, name: a.name }),
                        )
                      }
                    >
                      {busy === `${a.applicationId}:${to}` ? t("saving") : t("move", { to })}
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
