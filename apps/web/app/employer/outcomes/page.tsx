"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { dayKey, type OutcomeRow, type Outcomes, type RecordOutcome } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, BoardInput } from "@/components/board/field";
import { PersonName } from "@/components/person-name";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useMembership } from "@/lib/membership";
import { useUnread } from "@/lib/unread";
import { useErrorText } from "@/lib/use-error-text";

// A calendar day as the page shows it: noon in India, so no zone moves it.
const asDate = (day: string) => new Date(`${day}T12:00:00+05:30`);

// One hire: what is known, who said it, and, for whatever is due, a one-tap
// answer. "Not sure yet" is simply leaving it: unknown is a real answer.
function Row({ row, onChanged }: { row: OutcomeRow; onChanged: (next: OutcomeRow) => void }) {
  const t = useTranslations("outcomes");
  const errorText = useErrorText();
  const { formatDate } = useFormat();
  const runs = useMembership().can("runDrives");
  const [joining, setJoining] = useState(row.joiningDate ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = dayKey(new Date());

  async function record(input: RecordOutcome) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await apiClient.recordOutcome(row.applicationId, input));
    } catch (err) {
      setError(errorText(err, "outcomes.failed"));
    } finally {
      setBusy(false);
    }
  }

  const canAskStarted = runs && (row.joiningDate === null || row.joiningDate <= today);
  return (
    <li className="grid gap-2 border-b border-housing-line py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="type-body">
          {row.candidateName} <span className="type-meta text-housing-muted">{t("hiredFor", { role: row.roleTitle, day: formatDate(new Date(row.driveStartsAt)) })}</span>
        </p>
        <Link href={`/employer/drives/${row.driveId}/messages/${row.applicationId}`} className="type-meta underline underline-offset-4">
          {t("message")}
        </Link>
      </div>

      <dl className="grid gap-1 sm:grid-cols-3">
        <div>
          <dt className="type-meta text-housing-muted">{t("joining")}</dt>
          <dd className="type-board-sm">{row.joiningDate ? formatDate(asDate(row.joiningDate)) : t("unknown")}</dd>
          {row.joiningDateBy && <dd className="type-meta text-housing-muted">{t.rich("by", { name: () => <PersonName person={row.joiningDateBy!} /> })}</dd>}
        </div>
        <div>
          <dt className="type-meta text-housing-muted">{t("started")}</dt>
          <dd className="type-board-sm">
            {row.started === null ? t("unknown") : row.started ? t("startedOn", { day: formatDate(asDate(row.startedOn!)) }) : t("didNotStart")}
          </dd>
          {row.startedBy && <dd className="type-meta text-housing-muted">{t.rich("by", { name: () => <PersonName person={row.startedBy!} /> })}</dd>}
          {row.candidateStarted !== null && (
            <dd className="type-meta border-l-2 border-filling-lamp pl-2">{t("candidateSays", { started: row.candidateStarted ? "yes" : "no" })}</dd>
          )}
        </div>
        <div>
          <dt className="type-meta text-housing-muted">{t("retained")}</dt>
          <dd className="type-board-sm">{row.retained === null ? t("unknown") : row.retained ? t("stayed") : t("left")}</dd>
          {row.retainedBy && <dd className="type-meta text-housing-muted">{t.rich("by", { name: () => <PersonName person={row.retainedBy!} /> })}</dd>}
        </div>
      </dl>

      {runs && (
        <div className="flex flex-wrap items-end gap-2">
          {row.need === "joiningDate" || row.started === null ? (
            <>
              <label className="grid gap-1">
                <span className="type-meta text-housing-muted">{t("joiningDate")}</span>
                <BoardInput type="date" value={joining} onChange={(e) => setJoining(e.target.value)} className="w-auto" />
              </label>
              <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy || !joining || joining === row.joiningDate} onClick={() => record({ joiningDate: joining })}>
                {t("saveDate")}
              </BoardButton>
            </>
          ) : null}
          {canAskStarted && row.started === null && (
            <>
              <BoardButton className="min-h-9 px-3" disabled={busy} onClick={() => record({ started: true })}>
                {t("markStarted")}
              </BoardButton>
              <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy} onClick={() => record({ started: false })}>
                {t("markDidNotStart")}
              </BoardButton>
            </>
          )}
          {row.need === "retained" && (
            <>
              <BoardButton className="min-h-9 px-3" disabled={busy} onClick={() => record({ retained: true })}>
                {t("markStayed")}
              </BoardButton>
              <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy} onClick={() => record({ retained: false })}>
                {t("markLeft")}
              </BoardButton>
            </>
          )}
        </div>
      )}
      <p className="type-meta text-housing-muted">{t("editableUntil", { day: formatDate(asDate(row.editableUntil)) })}</p>
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
    </li>
  );
}

// What happened to the people the company hired: when they start, whether
// they did, whether they stayed. Mostly unknown, and the page says so rather
// than pretending otherwise.
export default function OutcomesPage() {
  const t = useTranslations("outcomes");
  const errorText = useErrorText();
  const { refresh } = useUnread();
  const [data, setData] = useState<Outcomes | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setData(await apiClient.companyOutcomes()), []);
  useEffect(() => {
    load().catch((err) => setError(errorText(err, "outcomes.loadFailed")));
  }, [load]);

  function changed(next: OutcomeRow) {
    setData((current) => current && { ...current, rows: current.rows.map((r) => (r.applicationId === next.applicationId ? next : r)) });
    refresh();
  }

  if (!data) return <p className="type-meta text-housing-muted">{error ?? t("loading")}</p>;
  const today = dayKey(new Date());
  const due = data.rows.filter((r) => r.need !== null);
  const upcoming = data.rows.filter((r) => r.need === null && r.joiningDate !== null && r.joiningDate > today);
  const rest = data.rows.filter((r) => !due.includes(r) && !upcoming.includes(r));

  const section = (key: "due" | "upcoming" | "recorded", rows: OutcomeRow[]) =>
    rows.length > 0 && (
      <section aria-labelledby={`${key}-heading`} className="grid gap-2">
        <h2 id={`${key}-heading`} className="type-h3">
          {t(`section.${key}`, { count: rows.length })}
        </h2>
        <ul className="border-t border-housing-line">
          {rows.map((row) => (
            <Row key={row.applicationId} row={row} onChanged={changed} />
          ))}
        </ul>
      </section>
    );

  return (
    <div className="grid gap-8">
      <div>
        <h1 className="type-h2">{t("heading")}</h1>
        <p className="type-meta mt-1 max-w-3xl text-housing-muted">{t("intro")}</p>
      </div>
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      {data.rows.length === 0 && <p className="type-meta text-housing-muted">{t("none")}</p>}
      {section("due", due)}
      {section("upcoming", upcoming)}
      {section("recorded", rest)}
    </div>
  );
}
