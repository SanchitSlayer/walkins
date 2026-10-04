"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  type Applicant,
  type ApplicantsAction,
  type Applicants,
  type ApplicationState,
  formatDistance,
  formatTime,
  languageName,
  READABLE_LANGUAGES,
} from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton } from "@/components/board/field";
import { cn } from "@/lib/utils";
import { IntroCell } from "./intro-cell";

const STATE: Record<ApplicationState, string> = {
  INTERESTED: "Saved",
  CONFIRMED: "Booked",
  CHECKED_IN: "Arrived",
  INTERVIEWED: "Interviewed",
  HIRED: "Hired",
  REJECTED: "Not selected",
  NO_SHOW: "Absent",
  WITHDRAWN: "Released seat",
  SCREENED_OUT: "Screened out",
};

const percent = (n: number) => `${Math.round(n * 100)}%`;

function MatchCell({ match }: { match: Applicant["match"] }) {
  return (
    <div className="grid gap-0.5">
      <span className="type-board-md">{percent(match.score)}</span>
      <span className="type-meta text-housing-muted">
        {match.basis === "distance_only"
          ? "Ranked by distance only"
          : `Profile fit ${percent(match.similarity ?? 0)} · nearness ${percent(match.distanceScore)}`}
      </span>
    </div>
  );
}

function KnockoutCell({ applicant }: { applicant: Applicant }) {
  if (applicant.knockout.length === 0) return <span className="type-meta text-housing-muted">No questions</span>;
  return (
    <ul className="grid gap-1">
      {applicant.knockout.map((k) => (
        <li key={k.prompt} className="type-meta">
          <span className="text-housing-muted">{k.prompt}</span> {k.answer}{" "}
          <span className={k.met ? "text-live-lamp" : "text-closing-lamp"}>{k.met ? "meets" : "doesn't meet"}</span>
        </li>
      ))}
    </ul>
  );
}

function LanguageSettings({ reads, onSaved }: { reads: string[]; onSaved: () => Promise<void> }) {
  const [selected, setSelected] = useState(reads);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setSelected(reads), [reads]);
  const changed = selected.length !== reads.length || selected.some((l) => !reads.includes(l));

  return (
    <details className="border border-housing-rule p-3">
      <summary className="type-meta cursor-pointer">
        Transcripts your team can read: {reads.map(languageName).join(", ") || "none"}
      </summary>
      <div className="mt-3 grid gap-3">
        <p className="type-meta text-housing-muted">
          A transcript written in a script nobody here reads is not shown; you&apos;re offered the recording instead.
        </p>
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
                setError(err instanceof Error ? err.message : "Couldn't save the languages");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving" : "Save languages"}
          </BoardButton>
          {error && <span className="type-meta text-closing-lamp">{error}</span>}
        </div>
      </div>
    </details>
  );
}

export default function ApplicantsPage() {
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
      setError(err instanceof Error ? err.message : "Couldn't load applicants");
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
      const question =
        `Mark ${chosen.length} ${chosen.length === 1 ? "applicant" : "applicants"} as not selected?` +
        (booked > 0
          ? ` ${booked} booked ${booked === 1 ? "candidate is" : "candidates are"} told not to travel, and their seats are freed.`
          : "");
      if (!confirm(question)) return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiClient.actOnApplicants(id, { applicationIds: [...selected], action });
      setNotice(
        result.skipped.length > 0
          ? `${result.updated} updated. ${result.skipped.length} left as they were: ${result.skipped[0].reason}`
          : `${result.updated} updated.`,
      );
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(false);
    }
  }

  async function markPresent(applicant: Applicant) {
    if (!confirm(`Let ${applicant.candidateName} in although they were screened out (${applicant.screenedOutReason})?`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.markPresent(applicant.applicationId, "admitted at the desk despite screening");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't mark them present");
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
            Drive
          </Link>
          <h1 className="type-h2 mt-1">Applicants</h1>
        </div>
        <label className="grid w-full max-w-sm gap-1">
          <span className="type-meta text-housing-muted">
            Rank by: nearness {percent(1 - weight)} · profile fit {percent(weight)}
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

      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-housing-line bg-housing py-2">
        <span className="type-meta text-housing-muted">{selected.size} selected</span>
        <BoardButton disabled={busy || selected.size === 0} onClick={() => act("shortlist")} className="min-h-9 px-3">
          Shortlist
        </BoardButton>
        <BoardButton variant="quiet" disabled={busy || selected.size === 0} onClick={() => act("unshortlist")} className="min-h-9 px-3">
          Remove from shortlist
        </BoardButton>
        <BoardButton variant="quiet" disabled={busy || selected.size === 0} onClick={() => act("reject")} className="min-h-9 px-3">
          Not selected
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

      {!data ? (
        <p role="status" className="type-meta text-housing-muted">
          Loading applicants
        </p>
      ) : applicants.length === 0 ? (
        <p className="type-body text-housing-muted">No one has applied yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] border-collapse text-left">
            <thead>
              <tr className="type-meta border-b border-housing-rule text-housing-muted">
                <th className="w-8 py-2 pr-2">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={selected.size > 0 && selected.size === applicants.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(applicants.map((a) => a.applicationId)) : new Set())}
                  />
                </th>
                <th className="py-2 pr-4 font-normal">Candidate</th>
                <th className="py-2 pr-4 font-normal">Match</th>
                <th className="py-2 pr-4 font-normal">Distance</th>
                <th className="py-2 pr-4 font-normal">Screening</th>
                <th className="w-[26rem] py-2 font-normal">Voice intro</th>
              </tr>
            </thead>
            <tbody>
              {applicants.map((a) => (
                <tr
                  key={a.applicationId}
                  className={cn("border-b border-housing-line align-top", a.state === "SCREENED_OUT" && "text-housing-muted")}
                >
                  <td className="py-3 pr-2">
                    <input
                      type="checkbox"
                      aria-label={`Select ${a.candidateName}`}
                      checked={selected.has(a.applicationId)}
                      onChange={() => toggle(a.applicationId)}
                    />
                  </td>
                  <td className="py-3 pr-4">
                    <div className="grid gap-0.5">
                      <span className="type-body">{a.candidateName}</span>
                      <span className="type-meta text-housing-muted">
                        {STATE[a.state]}
                        {a.slotStartsAt && ` · ${formatTime(a.slotStartsAt)}`} · {a.experienceYears} yrs
                      </span>
                      {a.shortlisted && <span className="type-meta text-live-lamp">Shortlisted</span>}
                      {a.state === "SCREENED_OUT" && (
                        <BoardButton
                          variant="quiet"
                          disabled={busy}
                          onClick={() => markPresent(a)}
                          className="mt-1 min-h-9 justify-self-start px-3"
                        >
                          Mark present anyway
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
