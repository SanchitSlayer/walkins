"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import type { DriveSearchPage } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { DriveCard } from "@/components/board/drive-card";
import { BoardField, BoardInput } from "@/components/board/field";
import { FlapDisplay } from "@/components/board/flap-display";
import { Slab } from "@/components/board/slab";

const CityPlane = dynamic(() => import("@/components/board/city-plane"), {
  ssr: false,
  loading: () => <div className="h-full min-h-[420px] border border-housing-line bg-housing-raised" />,
});

type Props = {
  city: string;
  heading: string;
  roleSlug?: string;
  initialData: DriveSearchPage;
  cityCenter: { lat: number; lng: number };
  initialRadiusKm?: string;
  initialFromDate?: string;
  initialToDate?: string;
  renderedAt: number;
};

export default function JobsSearchClient({
  city,
  heading,
  roleSlug,
  initialData,
  cityCenter,
  initialRadiusKm,
  initialFromDate,
  initialToDate,
  renderedAt,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const [data, setData] = useState(initialData);
  const [origin, setOrigin] = useState(cityCenter);
  const [originLabel, setOriginLabel] = useState("City centre");
  const [homeRadiusKm, setHomeRadiusKm] = useState<number | undefined>(undefined);
  const [radiusKm, setRadiusKm] = useState(initialRadiusKm ?? "");
  const [fromDate, setFromDate] = useState(initialFromDate ?? "");
  const [toDate, setToDate] = useState(initialToDate ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"list" | "map">("list");
  // Starts from the server's clock so the first client render matches the
  // server render exactly; then advances so a drive that ends while the page
  // is open moves to closing or expired without a reload.
  const [now, setNow] = useState(() => new Date(renderedAt));

  useEffect(() => {
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, []);

  const runSearch = useCallback(
    async (cursor?: string, append = false) => {
      setLoading(true);
      try {
        const result = await apiClient.searchDrives({
          city,
          role: roleSlug,
          radiusKm: radiusKm ? Number(radiusKm) : undefined,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
          cursor,
        });
        setData((prev) => (append ? { items: [...prev.items, ...result.items], nextCursor: result.nextCursor } : result));
      } finally {
        setLoading(false);
      }
    },
    [city, roleSlug, radiusKm, fromDate, toDate],
  );

  // The server render measures from the city centre; a candidate with a
  // saved home gets their own origin and travel radius once hydrated.
  useEffect(() => {
    apiClient.restoreSession().then(async (session) => {
      if (session?.role !== "CANDIDATE") return;
      const profile = await apiClient.getMyProfile();
      if (!profile) return;
      setOrigin({ lat: profile.homeLat, lng: profile.homeLng });
      setOriginLabel("Your home");
      setHomeRadiusKm(profile.maxTravelKm);
      await runSearch();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (radiusKm) params.set("radiusKm", radiusKm);
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    runSearch();
  }

  function selectFromMap(id: string) {
    setSelectedId(id);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`drive-${id}`)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }

  const count = data.items.length;
  const selected = data.items.find((d) => d.id === selectedId);
  const volumeKm = radiusKm ? Number(radiusKm) : homeRadiusKm;

  return (
    <>
      <div className="grid gap-4 border-b border-housing-line pb-6">
        <h1 className="type-h1">{heading}</h1>
        <p className="type-body flex flex-wrap items-center gap-x-3 gap-y-1 text-housing-muted">
          <FlapDisplay value={String(count)} length={2} align="right" className="text-[1.75rem] text-stock" cellWidth={0.62} />
          <span>
            {count === 1 ? "drive" : "drives"} {data.nextCursor ? "shown so far" : "listed"}, distances from{" "}
            {originLabel === "Your home" ? "your home" : "the city centre"}
          </span>
        </p>

        <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-3">
          <BoardField label="Within (km)" className="w-28">
            <BoardInput type="number" inputMode="decimal" min={1} board value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} />
          </BoardField>
          <BoardField label="From" className="w-40">
            <BoardInput type="date" board value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </BoardField>
          <BoardField label="To" className="w-40">
            <BoardInput type="date" board value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </BoardField>
          <Slab type="submit" depth="sm" disabled={loading} className="px-5 py-2.5">
            <span className="type-meta">{loading ? "Searching" : "Apply"}</span>
          </Slab>
        </form>

        <div className="flex gap-6 lg:hidden" role="group" aria-label="Show drives as">
          {(["list", "map"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={cn(
                "type-meta border-b-2 pb-1",
                view === option ? "border-stock text-stock" : "border-transparent text-housing-muted",
              )}
            >
              {option === "list" ? "List" : "Map"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-8 pt-6 lg:grid-cols-[minmax(0,27rem)_1fr]">
        <section aria-label="Drives" className={cn(view === "map" && "hidden lg:block")}>
          {count === 0 ? (
            <p className="type-body text-housing-muted">
              No live drives match these filters. Widen the distance or clear the dates.
            </p>
          ) : (
            <ul className="grid gap-6 pb-3 pr-3">
              {data.items.map((drive) => (
                <li
                  key={drive.id}
                  id={`drive-${drive.id}`}
                  onMouseEnter={() => setSelectedId(drive.id)}
                  onFocus={() => setSelectedId(drive.id)}
                >
                  <DriveCard drive={drive} now={now} selected={drive.id === selectedId} />
                </li>
              ))}
            </ul>
          )}
          {data.nextCursor && (
            <Slab
              onClick={() => runSearch(data.nextCursor ?? undefined, true)}
              disabled={loading}
              depth="sm"
              className="mt-4 px-5 py-2.5"
            >
              <span className="type-meta">{loading ? "Loading" : "Show more drives"}</span>
            </Slab>
          )}
        </section>

        <section aria-label="City map" className={cn("lg:sticky lg:top-6 lg:self-start", view === "list" && "hidden lg:block")}>
          <CityPlane
            drives={data.items}
            now={now}
            origin={origin}
            radiusKm={volumeKm}
            selectedId={selectedId}
            onSelect={selectFromMap}
            className="h-[60vh] min-h-[420px] lg:h-[calc(100vh-3rem)]"
          />
          <p className="type-meta mt-3 text-housing-muted">
            Pillar height is the drive&apos;s headcount; the lit top is seats still open. The white diamond is{" "}
            {originLabel === "Your home" ? "your home" : "the city centre"}
            {volumeKm
              ? `, and the ring is ${radiusKm ? "the distance you filtered by" : "how far you said you'll travel"} (${volumeKm} km).`
              : "."}
          </p>
          {view === "map" && selected && (
            <div className="mt-4 lg:hidden">
              <DriveCard drive={selected} now={now} selected />
            </div>
          )}
        </section>
      </div>
    </>
  );
}
