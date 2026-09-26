"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { CursorPage, DriveSearchResult } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DriveMap = dynamic(() => import("@/components/leaflet/drive-map"), { ssr: false });

type Props = {
  city: string;
  roleSlug?: string;
  initialData: CursorPage<DriveSearchResult>;
  cityCenter: { lat: number; lng: number };
  initialRadiusKm?: string;
  initialFromDate?: string;
  initialToDate?: string;
};

export default function JobsSearchClient({
  city,
  roleSlug,
  initialData,
  cityCenter,
  initialRadiusKm,
  initialFromDate,
  initialToDate,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const [data, setData] = useState(initialData);
  const [origin, setOrigin] = useState(cityCenter);
  const [radiusKm, setRadiusKm] = useState(initialRadiusKm ?? "");
  const [fromDate, setFromDate] = useState(initialFromDate ?? "");
  const [toDate, setToDate] = useState(initialToDate ?? "");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  // After hydration: if a candidate is logged in with a saved profile,
  // upgrade the origin from the city center (used for the SSR render) to
  // their real home location and re-run the search from there.
  useEffect(() => {
    apiClient.restoreSession().then(async (session) => {
      if (session?.role === "CANDIDATE") {
        const profile = await apiClient.getMyProfile();
        if (profile) {
          setOrigin({ lat: profile.homeLat, lng: profile.homeLng });
          await runSearch();
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyFilters() {
    const params = new URLSearchParams();
    if (radiusKm) params.set("radiusKm", radiusKm);
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
    runSearch();
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Radius (km)</label>
            <Input type="number" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)} className="w-28" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">From</label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">To</label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
          </div>
          <Button onClick={applyFilters} disabled={loading}>
            Apply
          </Button>
        </div>

        <ul className="space-y-3">
          {data.items.map((drive) => (
            <li key={drive.id}>
              <Link
                href={`/drives/${drive.id}`}
                onMouseEnter={() => setSelectedId(drive.id)}
                className={`block rounded-lg border p-4 hover:bg-accent ${
                  selectedId === drive.id ? "border-primary" : "border-border"
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="font-medium">{drive.role.title}</p>
                  <Badge variant="secondary">{drive.distanceKm.toFixed(1)} km</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {drive.venueAddress} · {new Date(drive.startsAt).toLocaleDateString("en-IN")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {"₹"}
                  {drive.salaryMin}
                  {"–₹"}
                  {drive.salaryMax}
                </p>
              </Link>
            </li>
          ))}
          {!loading && data.items.length === 0 && (
            <p className="text-sm text-muted-foreground">No live drives match these filters.</p>
          )}
        </ul>

        {data.nextCursor && (
          <Button variant="outline" onClick={() => runSearch(data.nextCursor ?? undefined, true)} disabled={loading}>
            Load more
          </Button>
        )}
      </div>

      <div>
        <DriveMap
          origin={origin}
          radiusKm={radiusKm ? Number(radiusKm) : undefined}
          drives={data.items}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>
    </div>
  );
}
