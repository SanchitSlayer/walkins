"use client";

import { useEffect, useState } from "react";
import type { CandidateRecord } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { Slab } from "@/components/board/slab";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";

const asDate = (day: string) => new Date(`${day}T12:00:00+05:30`);

// Everything Walkins has recorded about this person's drives, and, after a
// hire, each fact with who said it. No score: nothing uses one, and if one is
// ever shown to anyone, it is shown here first.
export function YourRecord() {
  const t = useTranslations("yourRecord");
  const { formatDate } = useFormat();
  const [record, setRecord] = useState<CandidateRecord | null>(null);

  useEffect(() => {
    apiClient.getMyRecord().then(setRecord, () => {});
  }, []);

  if (!record) return null;
  const known = (value: boolean | null, yes: string, no: string) => (value === null ? t("notRecorded") : value ? yes : no);

  return (
    <Slab depth="md" className="grid w-full gap-4 p-5">
      <div>
        <h2 className="type-h3">{t("heading")}</h2>
        <p className="type-meta mt-1 text-ink-muted">{t("intro")}</p>
      </div>
      {record.entries.length === 0 ? (
        <p className="type-meta text-ink-muted">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3">
          {record.entries.map((e) => (
            <li key={e.applicationId} className="grid gap-1 border-t border-ink-muted pt-3">
              <p className="type-body">{t("roleAt", { role: e.roleTitle, company: e.companyName })}</p>
              <p className="type-meta text-ink-muted">
                {formatDate(new Date(e.driveStartsAt))} · {t(`state.${e.state}`)}
                {e.markedAbsentAt && ` · ${t("markedOn", { day: formatDate(new Date(e.markedAbsentAt)) })}`}
              </p>
              {e.state === "notAttendedExcused" && <p className="type-meta">{t("excused")}</p>}
              {e.after && (
                <dl className="grid gap-0.5 border-l-2 border-ink-muted pl-3">
                  <div className="type-meta">
                    <dt className="inline text-ink-muted">{t("joining", { company: e.companyName })} </dt>
                    <dd className="inline">{e.after.joiningDate ? formatDate(asDate(e.after.joiningDate)) : t("notRecorded")}</dd>
                  </div>
                  <div className="type-meta">
                    <dt className="inline text-ink-muted">{t("started", { company: e.companyName })} </dt>
                    <dd className="inline">
                      {known(e.after.started, e.after.startedOn ? t("startedOn", { day: formatDate(asDate(e.after.startedOn)) }) : t("yes"), t("didNotStart"))}
                    </dd>
                  </div>
                  <div className="type-meta">
                    <dt className="inline text-ink-muted">{t("retained", { company: e.companyName })} </dt>
                    <dd className="inline">{known(e.after.retained, t("stayed"), t("left"))}</dd>
                  </div>
                  <div className="type-meta">
                    <dt className="inline text-ink-muted">{t("yourAnswer")} </dt>
                    <dd className="inline">{known(e.after.yourAnswer, t("youStarted"), t("youDidNotStart"))}</dd>
                  </div>
                </dl>
              )}
            </li>
          ))}
        </ul>
      )}
    </Slab>
  );
}
