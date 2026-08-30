"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { updateDriveSchema } from "@walkins/shared";
import type { DriveDetail } from "@/lib/api-client";
import { apiClient } from "@/lib/api-client";
import { useRequireEmployer } from "@/lib/use-require-employer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

function toDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function EditDrivePage() {
  const ready = useRequireEmployer();
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [drive, setDrive] = useState<DriveDetail | null>(null);
  const [roles, setRoles] = useState<{ id: string; title: string }[]>([]);
  const [cities, setCities] = useState<{ id: string; name: string; state: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ready) return;
    apiClient.getDrive(params.id).then(setDrive);
    apiClient.listRoles().then(setRoles);
    apiClient.listCities().then(setCities);
  }, [ready, params.id]);

  function setField<K extends keyof DriveDetail>(key: K, value: DriveDetail[K]) {
    setDrive((d) => (d ? { ...d, [key]: value } : d));
  }

  const editable = drive?.status === "DRAFT" || drive?.status === "PENDING";

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!drive) return;
    setError(null);

    const parsed = updateDriveSchema.safeParse({
      roleId: drive.roleId,
      cityId: drive.cityId,
      salaryMin: Number(drive.salaryMin),
      salaryMax: Number(drive.salaryMax),
      venueAddress: drive.venueAddress,
      startsAt: drive.startsAt,
      endsAt: drive.endsAt,
      capacity: Number(drive.capacity),
      experienceMin: Number(drive.experienceMin),
      experienceMax: Number(drive.experienceMax),
    });

    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }

    setLoading(true);
    try {
      const updated = await apiClient.updateDrive(drive.id, parsed.data);
      setDrive(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save drive");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitForReview() {
    if (!drive) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await apiClient.submitDrive(drive.id);
      setDrive(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit drive");
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    if (!drive) return;
    if (!confirm("Cancel this drive? This cannot be undone.")) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await apiClient.deleteDrive(drive.id);
      setDrive(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel drive");
    } finally {
      setLoading(false);
    }
  }

  if (!ready || !drive) {
    return null;
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{drive.role.title}</h1>
        <Badge>{drive.status}</Badge>
      </div>

      {drive.needsManualGeocode && (
        <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          This venue address could not be geocoded automatically. Coordinates are set to the city center — edit and
          re-save the address to retry.
        </p>
      )}

      <form className="space-y-4" onSubmit={handleSave}>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="roleId">Role</Label>
            <select
              id="roleId"
              disabled={!editable}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm disabled:opacity-50"
              value={drive.roleId}
              onChange={(e) => setField("roleId", e.target.value)}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.title}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cityId">City</Label>
            <select
              id="cityId"
              disabled={!editable}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm disabled:opacity-50"
              value={drive.cityId}
              onChange={(e) => setField("cityId", e.target.value)}
            >
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}, {city.state}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="venueAddress">Venue address</Label>
          <Input
            id="venueAddress"
            disabled={!editable}
            value={drive.venueAddress}
            onChange={(e) => setField("venueAddress", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="salaryMin">Salary min</Label>
            <Input
              id="salaryMin"
              type="number"
              disabled={!editable}
              value={drive.salaryMin}
              onChange={(e) => setField("salaryMin", Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="salaryMax">Salary max</Label>
            <Input
              id="salaryMax"
              type="number"
              disabled={!editable}
              value={drive.salaryMax}
              onChange={(e) => setField("salaryMax", Number(e.target.value))}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="startsAt">Starts at</Label>
            <Input
              id="startsAt"
              type="datetime-local"
              disabled={!editable}
              value={toDatetimeLocal(drive.startsAt)}
              onChange={(e) => setField("startsAt", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="endsAt">Ends at</Label>
            <Input
              id="endsAt"
              type="datetime-local"
              disabled={!editable}
              value={toDatetimeLocal(drive.endsAt)}
              onChange={(e) => setField("endsAt", e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="capacity">Total capacity</Label>
          <Input
            id="capacity"
            type="number"
            disabled={!editable}
            value={drive.capacity}
            onChange={(e) => setField("capacity", Number(e.target.value))}
          />
        </div>

        <div>
          <Label>Slots (fixed at creation)</Label>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {drive.slots.map((slot) => (
              <li key={slot.id}>
                {new Date(slot.startsAt).toLocaleString()} — {slot.bookedCount}/{slot.capacity} booked
              </li>
            ))}
          </ul>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {editable && (
          <div className="flex gap-3">
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save changes"}
            </Button>
            {drive.status === "DRAFT" && (
              <Button type="button" variant="outline" disabled={loading} onClick={handleSubmitForReview}>
                Submit for review
              </Button>
            )}
            <Button type="button" variant="destructive" disabled={loading} onClick={handleCancel}>
              Cancel drive
            </Button>
          </div>
        )}
      </form>

      <button type="button" className="text-sm text-muted-foreground underline" onClick={() => router.push("/employer/drives")}>
        Back to drives
      </button>
    </main>
  );
}
