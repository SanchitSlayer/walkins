"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createDriveSchema } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { useRequireEmployer } from "@/lib/use-require-employer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type FormState = {
  roleId: string;
  cityId: string;
  salaryMin: string;
  salaryMax: string;
  venueAddress: string;
  startsAt: string;
  endsAt: string;
  capacity: string;
  experienceMin: string;
  experienceMax: string;
  slotDurationMinutes: string;
  capacityPerSlot: string;
};

const EMPTY_FORM: FormState = {
  roleId: "",
  cityId: "",
  salaryMin: "",
  salaryMax: "",
  venueAddress: "",
  startsAt: "",
  endsAt: "",
  capacity: "",
  experienceMin: "0",
  experienceMax: "0",
  slotDurationMinutes: "60",
  capacityPerSlot: "",
};

export default function NewDrivePage() {
  const ready = useRequireEmployer();
  const router = useRouter();
  const [roles, setRoles] = useState<{ id: string; title: string }[]>([]);
  const [cities, setCities] = useState<{ id: string; name: string; state: string }[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ready) return;
    apiClient.listRoles().then(setRoles);
    apiClient.listCities().then(setCities);
  }, [ready]);

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = createDriveSchema.safeParse({
      roleId: form.roleId,
      cityId: form.cityId,
      salaryMin: Number(form.salaryMin),
      salaryMax: Number(form.salaryMax),
      venueAddress: form.venueAddress,
      startsAt: form.startsAt,
      endsAt: form.endsAt,
      capacity: Number(form.capacity),
      experienceMin: Number(form.experienceMin),
      experienceMax: Number(form.experienceMax),
      slotDurationMinutes: Number(form.slotDurationMinutes),
      capacityPerSlot: Number(form.capacityPerSlot),
    });

    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }

    setLoading(true);
    try {
      const drive = await apiClient.createDrive(parsed.data);
      router.push(`/employer/drives/${drive.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create drive");
    } finally {
      setLoading(false);
    }
  }

  if (!ready) {
    return null;
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-lg font-semibold">New drive</h1>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="roleId">Role</Label>
            <select
              id="roleId"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              value={form.roleId}
              onChange={(e) => set("roleId", e.target.value)}
            >
              <option value="">Select a role</option>
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
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              value={form.cityId}
              onChange={(e) => set("cityId", e.target.value)}
            >
              <option value="">Select a city</option>
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
            value={form.venueAddress}
            onChange={(e) => set("venueAddress", e.target.value)}
            placeholder="MG Road, Bengaluru"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="salaryMin">Salary min</Label>
            <Input id="salaryMin" type="number" value={form.salaryMin} onChange={(e) => set("salaryMin", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="salaryMax">Salary max</Label>
            <Input id="salaryMax" type="number" value={form.salaryMax} onChange={(e) => set("salaryMax", e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="experienceMin">Experience min (years)</Label>
            <Input
              id="experienceMin"
              type="number"
              value={form.experienceMin}
              onChange={(e) => set("experienceMin", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="experienceMax">Experience max (years)</Label>
            <Input
              id="experienceMax"
              type="number"
              value={form.experienceMax}
              onChange={(e) => set("experienceMax", e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="startsAt">Starts at</Label>
            <Input
              id="startsAt"
              type="datetime-local"
              value={form.startsAt}
              onChange={(e) => set("startsAt", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="endsAt">Ends at</Label>
            <Input id="endsAt" type="datetime-local" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="slotDurationMinutes">Slot duration (min)</Label>
            <Input
              id="slotDurationMinutes"
              type="number"
              value={form.slotDurationMinutes}
              onChange={(e) => set("slotDurationMinutes", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="capacityPerSlot">Capacity per slot</Label>
            <Input
              id="capacityPerSlot"
              type="number"
              value={form.capacityPerSlot}
              onChange={(e) => set("capacityPerSlot", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="capacity">Total capacity</Label>
            <Input id="capacity" type="number" value={form.capacity} onChange={(e) => set("capacity", e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Total capacity must equal capacity per slot × number of slots in the time window.
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={loading}>
          {loading ? "Creating..." : "Create drive"}
        </Button>
      </form>
    </main>
  );
}
