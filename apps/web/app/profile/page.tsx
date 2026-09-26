"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { MAX_TRAVEL_KM } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { useRequireRole } from "@/lib/use-require-role";
import { nearestCity } from "@/lib/geo";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const ProfileMap = dynamic(() => import("@/components/leaflet/profile-map"), { ssr: false });

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
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      }
    });
  }, [ready]);

  function toggleRole(roleId: string) {
    setSelectedRoleIds((ids) => (ids.includes(roleId) ? ids.filter((id) => id !== roleId) : [...ids, roleId]));
  }

  async function handleSave() {
    setError(null);
    setSaved(false);

    if (selectedRoleIds.length === 0) {
      setError("Select at least one role");
      return;
    }
    if (cities.length === 0) {
      return;
    }

    const city = nearestCity({ lat, lng }, cities);

    setLoading(true);
    try {
      await apiClient.updateMyProfile({
        cityId: city.id,
        homeLat: lat,
        homeLng: lng,
        maxTravelKm: radiusKm,
        experienceYears,
        roleIds: selectedRoleIds,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setLoading(false);
    }
  }

  if (!ready) {
    return null;
  }

  const detectedCity = cities.length > 0 ? nearestCity({ lat, lng }, cities) : null;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-lg font-semibold">Your profile</h1>
      <p className="text-sm text-muted-foreground">
        Drag the pin (or click the map) to set your home location. Drives within your travel radius will be shown
        to you.
      </p>

      <ProfileMap
        lat={lat}
        lng={lng}
        radiusKm={radiusKm}
        onChange={(newLat, newLng) => {
          setLat(newLat);
          setLng(newLng);
        }}
      />

      {detectedCity && (
        <p className="text-sm text-muted-foreground">
          Detected city: {detectedCity.name}, {detectedCity.state}
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="radius">Travel radius: {radiusKm} km</Label>
        <input
          id="radius"
          type="range"
          min={1}
          max={MAX_TRAVEL_KM}
          value={radiusKm}
          onChange={(e) => setRadiusKm(Number(e.target.value))}
          className="w-full"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="experience">Experience (years)</Label>
        <input
          id="experience"
          type="number"
          min={0}
          step={0.5}
          value={experienceYears}
          onChange={(e) => setExperienceYears(Number(e.target.value))}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
        />
      </div>

      <div className="space-y-2">
        <Label>Roles you&apos;re interested in</Label>
        <div className="flex flex-wrap gap-2">
          {roles.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => toggleRole(role.id)}
              className={`rounded-md border px-3 py-1 text-sm ${
                selectedRoleIds.includes(role.id) ? "border-primary bg-primary text-primary-foreground" : "border-input"
              }`}
            >
              {role.title}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-emerald-700">Profile saved.</p>}

      <Button onClick={handleSave} disabled={loading}>
        {loading ? "Saving..." : "Save profile"}
      </Button>
    </main>
  );
}
