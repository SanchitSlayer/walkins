"use client";

import { OUTCOME_MIN_RECORDED, type RetentionRow, type ShowUpBucket } from "@walkins/shared";
import { useTranslations } from "next-intl";

// One slice of show-up: who held a seat and how many came, with the count
// always beside the rate so a 100% from one person reads as one person.
export function ShowUpTable({ heading, buckets, label }: { heading: string; buckets: ShowUpBucket[]; label: (key: string) => string }) {
  const t = useTranslations("analytics.figures");
  return (
    <section className="grid content-start gap-2">
      <h3 className="type-meta text-housing-muted">{heading}</h3>
      {buckets.length === 0 ? (
        <p className="type-meta text-housing-muted">{t("noneYet")}</p>
      ) : (
        <table className="w-full border-collapse text-left">
          <tbody>
            {buckets.map((b) => (
              <tr key={b.key} className="type-meta border-b border-housing-line">
                <td className="py-1.5 pr-3">{label(b.key)}</td>
                <td className="type-board-sm py-1.5 pr-3 text-right">{t("rate", { n: Math.round((b.rate ?? 0) * 100) })}</td>
                <td className="py-1.5 text-right text-housing-muted">{t("ofHeld", { attended: b.attended, held: b.held })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// Thirty-day retention, with its coverage beside it and "not recorded" in a
// column of its own: never folded into "left". No rate below the minimum.
export function RetentionTable({ rows, keyHeading }: { rows: RetentionRow[]; keyHeading: string }) {
  const t = useTranslations("analytics.figures");
  if (rows.length === 0) return <p className="type-meta text-housing-muted">{t("noRetentionYet")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-left">
        <thead>
          <tr className="type-meta border-b border-housing-rule text-housing-muted">
            <th className="py-2 pr-4 font-normal">{keyHeading}</th>
            <th className="py-2 pr-4 text-right font-normal">{t("startedLongAgo")}</th>
            <th className="py-2 pr-4 text-right font-normal">{t("stayed")}</th>
            <th className="py-2 pr-4 text-right font-normal">{t("left")}</th>
            <th className="py-2 pr-4 text-right font-normal">{t("notRecorded")}</th>
            <th className="py-2 text-right font-normal">{t("retention")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="type-meta border-b border-housing-line">
              <td className="py-2 pr-4">{r.key}</td>
              <td className="type-board-sm py-2 pr-4 text-right">{r.eligible}</td>
              <td className="type-board-sm py-2 pr-4 text-right">{r.stayed}</td>
              <td className="type-board-sm py-2 pr-4 text-right">{r.left}</td>
              <td className="type-board-sm py-2 pr-4 text-right">{r.notRecorded}</td>
              <td className="py-2 text-right">
                {r.rate === null ? (
                  <span className="text-housing-muted">{t("tooFew", { recorded: r.stayed + r.left, min: OUTCOME_MIN_RECORDED })}</span>
                ) : (
                  <>
                    <span className="type-board-sm">{t("rate", { n: Math.round(r.rate * 100) })}</span>{" "}
                    <span className="text-housing-muted">{t("coverage", { recorded: r.stayed + r.left, eligible: r.eligible })}</span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
