"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { type Applicant, type ApplicantsAction, type Applicants, READABLE_LANGUAGES } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton } from "@/components/board/field";
import { cn } from "@/lib/utils";
import { IntroCell } from "./intro-cell";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";
import { useMembership } from "@/lib/membership";
import { usePersonName } from "@/components/person-name";
import { ReportCandidate } from "@/components/report-candidate";

const percent = (n: number) => Math.round(n * 100);

function MatchCell({ match }: { match: Applicant["match"] }) {
  const t = useTranslations("applicants");
  return (
    <div className="grid gap-0.5">
      <span className="type-board-md">{t("percent", { n: percent(match.score) })}</span>
      <span className="type-meta text-housing-muted">
        {match.basis === "distance_only"
          ? t("distanceOnly")
          : t("matchParts", { fit: percent(match.similarity ?? 0), near: percent(match.distanceScore) })}
      </span>
    </div>
  );
}

function KnockoutCell({ applicant }: { applicant: Applicant }) {
  const t = useTranslations("applicants");
  const answer = (value: Applicant["knockout"][number]["answer"]) =>
    value === null ? t("noAnswer") : typeof value === "boolean" ? (value ? t("yes") : t("no")) : String(value);
  if (applicant.knockout.length === 0) return <span className="type-meta text-housing-muted">{t("noQuestions")}</span>;
  return (
    <ul className="grid gap-1">
      {applicant.knockout.map((k) => (
        <li key={k.prompt} className="type-meta">
          <span className="text-housing-muted">{k.prompt}</span> {answer(k.answer)}{" "}
          <span className={k.met ? "text-live-lamp" : "text-closing-lamp"}>{k.met ? t("meets") : t("doesNotMeet")}</span>
        </li>
      ))}
    </ul>
  );
}

function LanguageSettings({ reads, onSaved }: { reads: string[]; onSaved: () => Promise<void> }) {
  const t = useTranslations("applicants.languages");
  const errorText = useErrorText();
  const { languageName } = useFormat();
  const ownsSettings = useMembership().can("manageCompany");
  const [selected, setSelected] = useState(reads);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSelected(reads), [reads]);
  const changed = selected.length !== reads.length || selected.some((l) => !reads.includes(l));

  return (
    <details className="border border-housing-rule p-3">
      <summary className="type-meta cursor-pointer">
        {t("summary", { languages: reads.map(languageName).join(", ") || t("none") })}
      </summary>
      <div className="mt-3 grid gap-3">
        <p className="type-meta text-housing-muted">{t("explain")}</p>
        {!ownsSettings && <p className="type-meta text-housing-muted">{t("ownerOnly")}</p>}
        {ownsSettings && (
          <>
            <div className="flex flex-wrap gap-2">
              {READABLE_LANGUAGES.map((code) => (
                <label key={code} className="type-meta flex min-h-9 items-center gap-2 border border-housing-rule px-3">
                  <input
                    type="checkbox"
                    checked={selected.includes(code)}
                    onChange={(e) => setSelected(e.target.checked ? [...selected, code] : selected.filter((l) => l !== code))}
                  />
                  {languageName(code)}
                </label>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <BoardButton
                disabled={!changed || saving}
                onClick={async () => {
                  setSaving(true);
                  setError(null);
                  try {
                    await apiClient.updateCompanySettings({ readsLanguages: selected });
                    await onSaved();
                  } catch (err) {
                    setError(errorText(err, "applicants.languages.saveFailed"));
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? t("saving") : t("save")}
              </BoardButton>
              {error && <span className="type-meta text-closing-lamp">{error}</span>}
            </div>
          </>
        )}
      </div>
    </details>
  );
}

export default function ApplicantsPage() {
  const t = useTranslations("applicants");
  const state = useTranslations("deskState");
  const all = useTranslations();
  const errorText = useErrorText();
  const { formatDistance, formatTime } = useFormat();
  const runs = useMembership().can("runDrives");
  const personName = usePersonName();
  const { id } = useParams<{ id: string }>();
  const [weight, setWeight] = useState(0.5);
  const [data, setData] = useState<Applicants | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiClient.listApplicants(id, weight));
    } catch (err) {
      setError(errorText(err, "applicants.loadFailed"));
    }
  }, [id, weight]);

  // The slider re-ranks on the server; waiting for it to settle avoids a
  // request for every step it passes through.
  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [load]);

  const applicants = data?.applicants ?? [];
  const chosen = applicants.filter((a) => selected.has(a.applicationId));

  async function act(action: ApplicantsAction["action"]) {
    if (action === "reject") {
      const booked = chosen.filter((a) => a.state === "CONFIRMED").length;
      if (!confirm(t("rejectConfirm", { count: chosen.length, booked }))) return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiClient.actOnApplicants(id, { applicationIds: [...selected], action });
      setNotice(
        result.skipped.length > 0
          ? t("updatedSkipped", { updated: result.updated, skipped: result.skipped.length, reason: all(result.skipped[0].code) })
          : t("updated", { updated: result.updated }),
      );
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(errorText(err, "errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  async function markPresent(applicant: Applicant) {
    if (!confirm(t("admitConfirm", { name: applicant.candidateName, reason: applicant.screenedOutReason ?? "" }))) return;
    setBusy(true);
    setError(null);
    try {
      // Recorded in the audit log, for whoever reads it later; not shown here.
      await apiClient.markPresent(applicant.applicationId, "admitted at the desk despite screening"); // i18n-ignore: audit log reason
      await load();
    } catch (err) {
      setError(errorText(err, "applicants.markFailed"));
    } finally {
      setBusy(false);
    }
  }

  function toggle(applicationId: string) {
    const next = new Set(selected);
    if (next.has(applicationId)) next.delete(applicationId);
    else next.add(applicationId);
    setSelected(next);
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/employer/drives/${id}`} className="type-meta text-housing-muted underline-offset-4 hover:underline">
            {t("back")}
          </Link>
          <h1 className="type-h2 mt-1">{t("heading")}</h1>
        </div>
        <label className="grid w-full max-w-sm gap-1">
          <span className="type-meta text-housing-muted">
            {t("rankBy", { near: percent(1 - weight), fit: percent(weight) })}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            className="accent-[var(--stock)]"
          />
        </label>
      </div>

      {data && <LanguageSettings reads={data.readsLanguages} onSaved={load} />}

      {runs && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-housing-line bg-housing py-2">
          <span className="type-meta text-housing-muted">{t("selected", { count: selected.size })}</span>
          <BoardButton disabled={busy || selected.size === 0} onClick={() => act("shortlist")} className="min-h-9 px-3">
            {t("shortlist")}
          </BoardButton>
          <BoardButton variant="quiet" disabled={busy || selected.size === 0} onClick={() => act("unshortlist")} className="min-h-9 px-3">
            {t("unshortlist")}
          </BoardButton>
          <BoardButton variant="quiet" disabled={busy || selected.size === 0} onClick={() => act("reject")} className="min-h-9 px-3">
            {t("reject")}
          </BoardButton>
          {notice && (
            <span role="status" className="type-meta">
              {notice}
            </span>
          )}
          {error && (
            <span role="alert" className="type-meta text-closing-lamp">
              {error}
            </span>
          )}
        </div>
      )}
      {!runs && error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}

      {!data ? (
        <p role="status" className="type-meta text-housing-muted">
          {t("loading")}
        </p>
      ) : applicants.length === 0 ? (
        <p className="type-body text-housing-muted">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] border-collapse text-left">
            <thead>
              <tr className="type-meta border-b border-housing-rule text-housing-muted">
                <th className="w-8 py-2 pr-2">
                  {runs && (
                    <input
                      type="checkbox"
                      aria-label={t("selectAll")}
                      checked={selected.size > 0 && selected.size === applicants.length}
                      onChange={(e) => setSelected(e.target.checked ? new Set(applicants.map((a) => a.applicationId)) : new Set())}
                    />
                  )}
                </th>
                <th className="py-2 pr-4 font-normal">{t("candidate")}</th>
                <th className="py-2 pr-4 font-normal">{t("match")}</th>
                <th className="py-2 pr-4 font-normal">{t("distance")}</th>
                <th className="py-2 pr-4 font-normal">{t("screening")}</th>
                <th className="w-[26rem] py-2 font-normal">{t("voiceIntro")}</th>
              </tr>
            </thead>
            <tbody>
              {applicants.map((a) => (
                <tr
                  key={a.applicationId}
                  className={cn("border-b border-housing-line align-top", a.state === "SCREENED_OUT" && "text-housing-muted")}
                >
                  <td className="py-3 pr-2">
                    {runs && (
                      <input
                        type="checkbox"
                        aria-label={t("select", { name: a.candidateName })}
                        checked={selected.has(a.applicationId)}
                        onChange={() => toggle(a.applicationId)}
                      />
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <div className="grid gap-0.5">
                      <span className="type-body">{a.candidateName}</span>
                      <span className="type-meta text-housing-muted">
                        {[state(a.state), a.slotStartsAt ? formatTime(a.slotStartsAt) : null, t("years", { years: a.experienceYears })]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {a.shortlisted && (
                        <span className="type-meta text-live-lamp">
                          {a.shortlistedBy ? t("shortlistedBy", { name: personName(a.shortlistedBy) }) : t("shortlisted")}
                        </span>
                      )}
                      <ReportCandidate applicationId={a.applicationId} name={a.candidateName} />
                      {runs && a.state === "SCREENED_OUT" && (
                        <BoardButton
                          variant="quiet"
                          disabled={busy}
                          onClick={() => markPresent(a)}
                          className="mt-1 min-h-9 justify-self-start px-3"
                        >
                          {t("admit")}
                        </BoardButton>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <MatchCell match={a.match} />
                  </td>
                  <td className="type-board-md py-3 pr-4 whitespace-nowrap">{formatDistance(a.distanceKm)}</td>
                  <td className="py-3 pr-4">
                    <KnockoutCell applicant={a} />
                  </td>
                  <td className="py-3">
                    <IntroCell applicationId={a.applicationId} intro={a.intro} readsLanguages={data.readsLanguages} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
