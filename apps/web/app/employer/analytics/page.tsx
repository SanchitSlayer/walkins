"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Analytics, DriveFunnel } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardSelect } from "@/components/board/field";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";

const AXIS = { stroke: "var(--housing-rule)", tick: { fill: "var(--housing-muted)", fontSize: 12 }, tickLine: false };
const TOOLTIP = {
  contentStyle: { background: "var(--housing-raised)", border: "1px solid var(--housing-rule)", borderRadius: 0 },
  labelStyle: { color: "var(--stock)" },
  itemStyle: { color: "var(--stock)" },
  cursor: { fill: "var(--housing-line)", stroke: "var(--housing-rule)" },
};

const STAGES = ["alerted", "interested", "confirmed", "checkedIn", "hired"] as const;

function total(drives: DriveFunnel[], key: keyof DriveFunnel) {
  return drives.reduce((sum, d) => sum + (d[key] as number), 0);
}

export default function AnalyticsPage() {
  const t = useTranslations("analytics");
  const errorText = useErrorText();
  const { dayLabel, formatTime } = useFormat();
  const percent = (n: number | null) => (n === null ? t("noRate") : t("rate", { n: Math.round(n * 100) }));
  const [data, setData] = useState<Analytics | null>(null);
  const [driveId, setDriveId] = useState("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getAnalytics()
      .then(setData)
      .catch((err) => setError(errorText(err, "analytics.loadFailed")));
  }, []);

  if (!data) {
    return (
      <p role="status" className="type-meta text-housing-muted">
        {error ?? t("loading")}
      </p>
    );
  }

  const now = new Date();
  const scope = driveId === "all" ? data.drives : data.drives.filter((d) => d.driveId === driveId);
  const funnel = STAGES.map((key) => ({ stage: t(`stage.${key}`), people: total(scope, key) }));
  const confirmed = total(scope, "confirmed");
  const showUp = confirmed > 0 ? total(scope, "checkedIn") / confirmed : null;
  const walkIns = total(scope, "walkIns");
  const daily = data.daily.map((d) => ({ ...d, label: dayLabel(new Date(`${d.day}T12:00:00+05:30`), now) }));

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-h2">{t("heading")}</h1>
          <p className="type-meta mt-1 text-housing-muted">
            {data.refreshedAt ? t("refreshed", { time: formatTime(data.refreshedAt) }) : t("notRefreshed")}
          </p>
        </div>
        <label className="grid w-full max-w-xs gap-1">
          <span className="type-meta text-housing-muted">{t("drive")}</span>
          <BoardSelect value={driveId} onChange={(e) => setDriveId(e.target.value)}>
            <option value="all">{t("allDrives")}</option>
            {data.drives.map((d) => (
              <option key={d.driveId} value={d.driveId}>
                {t("driveOption", { role: d.roleTitle, day: dayLabel(new Date(d.startsAt), now) })}
              </option>
            ))}
          </BoardSelect>
        </label>
      </div>

      <section aria-labelledby="funnel-heading" className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid gap-2">
          <h2 id="funnel-heading" className="type-h3">
            {t("funnelHeading")}
          </h2>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={funnel} layout="vertical" margin={{ left: 8, right: 48 }}>
                <CartesianGrid horizontal={false} stroke="var(--housing-line)" />
                <XAxis type="number" allowDecimals={false} {...AXIS} />
                <YAxis type="category" dataKey="stage" width={88} {...AXIS} />
                <Tooltip {...TOOLTIP} formatter={(v: number) => [v, t("people")]} />
                <Bar dataKey="people" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={28} isAnimationActive={false}>
                  <LabelList dataKey="people" position="right" fill="var(--stock)" fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <dl className="grid content-start gap-4 border-l border-housing-line pl-6">
          <div>
            <dt className="type-meta text-housing-muted">{t("showUpRate")}</dt>
            <dd className="type-board-lg">{percent(showUp)}</dd>
            <dd className="type-meta text-housing-muted">{t("showUpExplain")}</dd>
          </div>
          <div>
            <dt className="type-meta text-housing-muted">{t("walkIns")}</dt>
            <dd className="type-board-md">{walkIns}</dd>
            <dd className="type-meta text-housing-muted">{t("walkInsExplain")}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="daily-heading" className="grid gap-2">
        <h2 id="daily-heading" className="type-h3">
          {t("dailyHeading")}
        </h2>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={daily} margin={{ left: 0, right: 16, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--housing-line)" />
              <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={24} {...AXIS} />
              <YAxis allowDecimals={false} width={32} {...AXIS} />
              <Tooltip {...TOOLTIP} />
              <Legend wrapperStyle={{ color: "var(--housing-muted)", fontSize: 12 }} />
              <Line type="monotone" dataKey="checkIns" name={t("checkIns")} stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="hires" name={t("hires")} stroke="var(--chart-2)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section aria-labelledby="drives-heading" className="grid gap-2">
        <h2 id="drives-heading" className="type-h3">
          {t("byDrive")}
        </h2>
        {data.drives.length === 0 ? (
          <p className="type-body text-housing-muted">{t("noDrives")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-left">
              <thead>
                <tr className="type-meta border-b border-housing-rule text-housing-muted">
                  <th className="py-2 pr-4 font-normal">{t("drive")}</th>
                  {STAGES.map((key) => (
                    <th key={key} className="py-2 pr-4 text-right font-normal">
                      {t(`stage.${key}`)}
                    </th>
                  ))}
                  <th className="py-2 pr-4 text-right font-normal">{t("walkIns")}</th>
                  <th className="py-2 text-right font-normal">{t("showUp")}</th>
                </tr>
              </thead>
              <tbody>
                {data.drives.map((d) => (
                  <tr key={d.driveId} className="type-meta border-b border-housing-line">
                    <td className="py-2 pr-4">
                      {d.roleTitle}
                      <span className="text-housing-muted">
                        {" "}
                        · {dayLabel(new Date(d.startsAt), now)} · {t(`status.${d.status}`)}
                      </span>
                    </td>
                    {STAGES.map((key) => (
                      <td key={key} className="type-board-md py-2 pr-4 text-right">
                        {d[key]}
                      </td>
                    ))}
                    <td className="type-board-md py-2 pr-4 text-right">{d.walkIns}</td>
                    <td className="type-board-md py-2 text-right">{percent(d.showUpRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
