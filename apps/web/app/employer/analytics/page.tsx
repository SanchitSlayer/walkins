"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { type Analytics, type DriveFunnel, dayLabel, formatTime } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardSelect } from "@/components/board/field";

const AXIS = { stroke: "var(--housing-rule)", tick: { fill: "var(--housing-muted)", fontSize: 12 }, tickLine: false };
const TOOLTIP = {
  contentStyle: { background: "var(--housing-raised)", border: "1px solid var(--housing-rule)", borderRadius: 0 },
  labelStyle: { color: "var(--stock)" },
  itemStyle: { color: "var(--stock)" },
  cursor: { fill: "var(--housing-line)", stroke: "var(--housing-rule)" },
};

const STAGES: { key: keyof DriveFunnel; label: string }[] = [
  { key: "alerted", label: "Alerted" },
  { key: "interested", label: "Applied" },
  { key: "confirmed", label: "Booked" },
  { key: "checkedIn", label: "Checked in" },
  { key: "hired", label: "Hired" },
];

const percent = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

function total(drives: DriveFunnel[], key: keyof DriveFunnel) {
  return drives.reduce((sum, d) => sum + (d[key] as number), 0);
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [driveId, setDriveId] = useState("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .getAnalytics()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load analytics"));
  }, []);

  if (!data) {
    return (
      <p role="status" className="type-meta text-housing-muted">
        {error ?? "Loading analytics"}
      </p>
    );
  }

  const now = new Date();
  const scope = driveId === "all" ? data.drives : data.drives.filter((d) => d.driveId === driveId);
  const funnel = STAGES.map((s) => ({ stage: s.label, people: total(scope, s.key) }));
  const confirmed = total(scope, "confirmed");
  const showUp = confirmed > 0 ? total(scope, "checkedIn") / confirmed : null;
  const walkIns = total(scope, "walkIns");
  const daily = data.daily.map((d) => ({ ...d, label: dayLabel(new Date(`${d.day}T12:00:00+05:30`), now) }));

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-h2">Analytics</h1>
          <p className="type-meta mt-1 text-housing-muted">
            {data.refreshedAt
              ? `Updated every 15 minutes; last at ${formatTime(data.refreshedAt)}.`
              : "Updated every 15 minutes; not refreshed since the worker started."}
          </p>
        </div>
        <label className="grid w-full max-w-xs gap-1">
          <span className="type-meta text-housing-muted">Drive</span>
          <BoardSelect value={driveId} onChange={(e) => setDriveId(e.target.value)}>
            <option value="all">All drives</option>
            {data.drives.map((d) => (
              <option key={d.driveId} value={d.driveId}>
                {d.roleTitle}, {dayLabel(new Date(d.startsAt), now)}
              </option>
            ))}
          </BoardSelect>
        </label>
      </div>

      <section aria-labelledby="funnel-heading" className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid gap-2">
          <h2 id="funnel-heading" className="type-h3">
            From alert to hire
          </h2>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={funnel} layout="vertical" margin={{ left: 8, right: 48 }}>
                <CartesianGrid horizontal={false} stroke="var(--housing-line)" />
                <XAxis type="number" allowDecimals={false} {...AXIS} />
                <YAxis type="category" dataKey="stage" width={88} {...AXIS} />
                <Tooltip {...TOOLTIP} formatter={(v: number) => [v, "People"]} />
                <Bar dataKey="people" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={28} isAnimationActive={false}>
                  <LabelList dataKey="people" position="right" fill="var(--stock)" fontSize={12} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <dl className="grid content-start gap-4 border-l border-housing-line pl-6">
          <div>
            <dt className="type-meta text-housing-muted">Show-up rate</dt>
            <dd className="type-board-lg">{percent(showUp)}</dd>
            <dd className="type-meta text-housing-muted">of everyone who booked a seat checked in</dd>
          </div>
          <div>
            <dt className="type-meta text-housing-muted">Walk-ins</dt>
            <dd className="type-board-md">{walkIns}</dd>
            <dd className="type-meta text-housing-muted">checked in without booking; not in the funnel</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="daily-heading" className="grid gap-2">
        <h2 id="daily-heading" className="type-h3">
          Last 30 days, all drives
        </h2>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={daily} margin={{ left: 0, right: 16, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--housing-line)" />
              <XAxis dataKey="label" interval="preserveStartEnd" minTickGap={24} {...AXIS} />
              <YAxis allowDecimals={false} width={32} {...AXIS} />
              <Tooltip {...TOOLTIP} />
              <Legend wrapperStyle={{ color: "var(--housing-muted)", fontSize: 12 }} />
              <Line type="monotone" dataKey="checkIns" name="Verified check-ins" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="hires" name="Hires" stroke="var(--chart-2)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section aria-labelledby="drives-heading" className="grid gap-2">
        <h2 id="drives-heading" className="type-h3">
          By drive
        </h2>
        {data.drives.length === 0 ? (
          <p className="type-body text-housing-muted">No drives have been submitted yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-left">
              <thead>
                <tr className="type-meta border-b border-housing-rule text-housing-muted">
                  <th className="py-2 pr-4 font-normal">Drive</th>
                  {STAGES.map((s) => (
                    <th key={s.key} className="py-2 pr-4 text-right font-normal">
                      {s.label}
                    </th>
                  ))}
                  <th className="py-2 pr-4 text-right font-normal">Walk-ins</th>
                  <th className="py-2 text-right font-normal">Show-up</th>
                </tr>
              </thead>
              <tbody>
                {data.drives.map((d) => (
                  <tr key={d.driveId} className="type-meta border-b border-housing-line">
                    <td className="py-2 pr-4">
                      {d.roleTitle}
                      <span className="text-housing-muted">
                        {" "}
                        · {dayLabel(new Date(d.startsAt), now)} · {d.status.toLowerCase()}
                      </span>
                    </td>
                    {STAGES.map((s) => (
                      <td key={s.key} className="type-board-md py-2 pr-4 text-right">
                        {d[s.key] as number}
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
