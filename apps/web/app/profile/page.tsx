"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { MAX_TRAVEL_KM } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { useRequireRole } from "@/lib/use-require-role";
import { nearestCity } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { BoardButton, BoardField, BoardInput } from "@/components/board/field";
import { Masthead } from "@/components/board/masthead";
import { Slab } from "@/components/board/slab";
import { TelegramPanel } from "./telegram-panel";

const PinMap = dynamic(() => import("@/components/board/pin-map"), {
  ssr: false,
  loading: () => <div className="h-[420px] border border-housing-line bg-housing-raised" />,
});

const DEFAULT_LAT = 12.9716;
const DEFAULT_LNG = 77.5946;

export default function ProfilePage() {
  const ready = useRequireRole("CANDIDATE");
  const [roles, setRoles] = useState<{ id: string; title: string }[]>([]);
  const [cities, setCities] = useState<
    { id: string; name: string; state: string; centerLat: number; centerLng: number }[]
  >([]);
  const [lat, setLat] = useState(DEFAULT_LAT);
  const [lng, setLng] = useState(DEFAULT_LNG);
  const [radiusKm, setRadiusKm] = useState(10);
  const [experienceYears, setExperienceYears] = useState(0);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [telegramConnected, setTelegramConnected] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ready) return;
    apiClient.listRoles().then(setRoles);
    apiClient.listCities().then(setCities);
    apiClient.getMyProfile().then((profile) => {
      if (profile) {
        setLat(profile.homeLat);
        setLng(profile.homeLng);
        setRadiusKm(profile.maxTravelKm);
        setExperienceYears(profile.experienceYears);
        setSelectedRoleIds(profile.roleIds);
        setTelegramConnected(profile.telegramConnected);
      }
      setLoaded(true);
    });
  }, [ready]);

  function moveHome(newLat: number, newLng: number) {
    setLat(newLat);
    setLng(newLng);
    setSaved(false);
  }

  function toggleRole(roleId: string) {
    setSaved(false);
    setSelectedRoleIds((ids) => (ids.includes(roleId) ? ids.filter((id) => id !== roleId) : [...ids, roleId]));
  }

  function locateHome() {
    setError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        moveHome(position.coords.latitude, position.coords.longitude);
        setLocating(false);
      },
      () => {
        setError("Your browser didn't share a location. Place the diamond on the map instead.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function handleSave() {
    setError(null);
    setSaved(false);

    if (selectedRoleIds.length === 0) {
      setError("Pick at least one role you'd walk in for.");
      return;
    }
    if (cities.length === 0) {
      return;
    }

    const city = nearestCity({ lat, lng }, cities);

    setLoading(true);
    try {
      const profile = await apiClient.updateMyProfile({
        cityId: city.id,
        homeLat: lat,
        homeLng: lng,
        maxTravelKm: radiusKm,
        experienceYears,
        roleIds: selectedRoleIds,
      });
      setTelegramConnected(profile.telegramConnected);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your profile");
    } finally {
      setLoading(false);
    }
  }

  const detectedCity = cities.length > 0 ? nearestCity({ lat, lng }, cities) : null;

  return (
    <div className="min-h-screen bg-housing text-stock">
      <Masthead />
      {ready && loaded && (
        <main className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-10">
          <div className="grid content-start gap-6">
            <div>
              <h1 className="type-h1">Where you&apos;ll travel from</h1>
              <p className="type-body mt-2 text-housing-muted">
                Drives within your travel distance of home are the ones we&apos;ll show you first.
              </p>
            </div>

            <Slab depth="md" className="grid w-full gap-6 p-5">
              <BoardField label={`Travel distance: ${radiusKm} km`} surface="stock">
                <input
                  type="range"
                  min={1}
                  max={MAX_TRAVEL_KM}
                  value={radiusKm}
                  onChange={(e) => {
                    setRadiusKm(Number(e.target.value));
                    setSaved(false);
                  }}
                  aria-valuetext={`${radiusKm} kilometres`}
                  className="h-11 w-full accent-ink"
                />
              </BoardField>

              <BoardField label="Years of experience" surface="stock" className="w-40">
                <BoardInput
                  surface="stock"
                  board
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.5}
                  value={experienceYears}
                  onChange={(e) => {
                    setExperienceYears(Number(e.target.value));
                    setSaved(false);
                  }}
                />
              </BoardField>

              <fieldset>
                <legend className="type-meta text-ink-muted">Roles you&apos;d walk in for</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {roles.map((role) => {
                    const on = selectedRoleIds.includes(role.id);
                    return (
                      <button
                        key={role.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleRole(role.id)}
                        className={cn(
                          "type-meta inline-flex min-h-11 items-center gap-2 border px-3",
                          on ? "border-ink bg-ink text-stock" : "border-ink-muted text-ink hover:bg-stock-edge",
                        )}
                      >
                        <span aria-hidden className={cn("h-2.5 w-2.5 border", on ? "border-stock bg-stock" : "border-ink-muted")} />
                        {role.title}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {error && (
                <p role="alert" className="type-meta text-closing-ink">
                  {error}
                </p>
              )}
              <p role="status" className={cn("type-meta text-live-ink", !saved && "sr-only")}>
                {saved ? "Saved. Search now measures from this home." : ""}
              </p>

              <BoardButton surface="stock" onClick={handleSave} disabled={loading}>
                {loading ? "Saving" : "Save profile"}
              </BoardButton>
            </Slab>

            <TelegramPanel connected={telegramConnected} />
          </div>

          <section aria-labelledby="home-heading" className="grid content-start gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="home-heading" className="type-h3">
                Home
              </h2>
              <BoardButton variant="quiet" onClick={locateHome} disabled={locating}>
                {locating ? "Finding you" : "Use my current location"}
              </BoardButton>
            </div>
            <PinMap lat={lat} lng={lng} radiusKm={radiusKm} onChange={moveHome} className="h-[420px] lg:h-[560px]" />
            <p className="type-meta text-housing-muted">
              Drag the diamond or click the map to move your home. The pale ring is how far you&apos;ll travel.
            </p>
            {detectedCity && (
              <p className="type-board-md">
                Nearest city: {detectedCity.name}, {detectedCity.state}
              </p>
            )}
          </section>
        </main>
      )}
    </div>
  );
}
