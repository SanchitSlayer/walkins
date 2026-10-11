"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminDrive, MessageKey } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton } from "@/components/board/field";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";

export default function DriveModerationPage() {
  const t = useTranslations("admin.drives");
  const all = useTranslations();
  const errorText = useErrorText();
  const { dayLabel, formatTime } = useFormat();
  const [drives, setDrives] = useState<AdminDrive[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setDrives(await apiClient.adminDrives()), []);
  useEffect(() => {
    load().catch((err) => setError(errorText(err, "admin.drives.loadFailed")));
  }, [load]);

  async function moderate(drive: AdminDrive, decision: "approve" | "reject") {
    let reason: string | undefined;
    if (decision === "reject") {
      const given = prompt(t("sendBackPrompt", { role: drive.roleTitle, company: drive.companyName }));
      if (given === null) return;
      reason = given.trim() || undefined;
    } else if (!confirm(t("approveConfirm", { role: drive.roleTitle, company: drive.companyName }))) {
      return;
    }
    setBusy(drive.id);
    setError(null);
    try {
      await apiClient.adminModerateDrive(drive.id, { decision, reason });
      await load();
    } catch (err) {
      setError(errorText(err, "errors.generic"));
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
        <h1 className="type-h2">{t("heading")}</h1>
        <p className="type-meta mt-1 text-housing-muted">{t("intro")}</p>
      </div>
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      {!drives ? (
        <p role="status" className="type-meta text-housing-muted">
          {t("loading")}
        </p>
      ) : (
        <>
          <section className="grid gap-3">
            <h2 className="type-h3">{t("waiting", { count: pending.length })}</h2>
            {pending.length === 0 && <p className="type-body text-housing-muted">{t("nothingWaiting")}</p>}
            <ul className="grid gap-3">
              {pending.map((d) => (
                <li key={d.id} className="grid gap-2 border border-housing-rule p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="type-body">
                      {t.rich("roleAt", {
                        role: d.roleTitle,
                        company: d.companyName,
                        quiet: (chunks) => <span className="text-housing-muted">{chunks}</span>,
                      })}
                    </p>
                    <p className="type-meta text-housing-muted">
                      {t("when", {
                        day: dayLabel(new Date(d.startsAt), now),
                        from: formatTime(d.startsAt),
                        to: formatTime(d.endsAt),
                        seats: d.capacity,
                      })}
                    </p>
                  </div>
                  <p className="type-meta text-housing-muted">
                    {t("venue", { venue: d.venueAddress, city: d.cityName })}
                  </p>
                  {d.blockers.length > 0 && (
                    <ul className="type-meta grid gap-1 border-l-4 border-closing-lamp pl-3">
                      {d.blockers.map((b) => (
                        <li key={b.code}>{all(b.code as MessageKey, b.params)}</li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <BoardButton className="min-h-9 px-3" disabled={busy === d.id || d.blockers.length > 0} onClick={() => moderate(d, "approve")}>
                      {t("approve")}
                    </BoardButton>
                    <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy === d.id} onClick={() => moderate(d, "reject")}>
                      {t("sendBack")}
                    </BoardButton>
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section className="grid gap-2">
            <h2 className="type-h3">{t("live", { count: live.length })}</h2>
            <ul className="type-meta grid">
              {live.map((d) => (
                <li key={d.id} className="border-b border-housing-line py-2">
                  {t.rich("liveRow", {
                    role: d.roleTitle,
                    company: d.companyName,
                    day: dayLabel(new Date(d.startsAt), now),
                    quiet: (chunks) => <span className="text-housing-muted">{chunks}</span>,
                  })}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
