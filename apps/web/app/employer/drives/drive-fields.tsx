"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { DriveSummary } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardField, BoardInput, BoardSelect } from "@/components/board/field";

export type DriveFieldValues = {
  roleId: string;
  cityId: string;
  venueAddress: string;
  salaryMin: string;
  salaryMax: string;
  experienceMin: string;
  experienceMax: string;
  startsAt: string;
  endsAt: string;
};

export const EMPTY_DRIVE_FIELDS: DriveFieldValues = {
  roleId: "",
  cityId: "",
  venueAddress: "",
  salaryMin: "",
  salaryMax: "",
  experienceMin: "0",
  experienceMax: "0",
  startsAt: "",
  endsAt: "",
};

function toDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function driveFieldValues(drive: DriveSummary): DriveFieldValues {
  return {
    roleId: drive.roleId,
    cityId: drive.cityId,
    venueAddress: drive.venueAddress,
    salaryMin: String(drive.salaryMin),
    salaryMax: String(drive.salaryMax),
    experienceMin: String(drive.experienceMin),
    experienceMax: String(drive.experienceMax),
    startsAt: toDatetimeLocal(drive.startsAt),
    endsAt: toDatetimeLocal(drive.endsAt),
  };
}

export function parseDriveFields(values: DriveFieldValues) {
  return {
    roleId: values.roleId,
    cityId: values.cityId,
    venueAddress: values.venueAddress,
    salaryMin: Number(values.salaryMin),
    salaryMax: Number(values.salaryMax),
    experienceMin: Number(values.experienceMin),
    experienceMax: Number(values.experienceMax),
    startsAt: values.startsAt,
    endsAt: values.endsAt,
  };
}

export function FieldGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-4 border-t border-housing-line pt-4 sm:grid-cols-2">
      <legend className="type-h3 float-left mb-1 w-full sm:col-span-2">{legend}</legend>
      {children}
    </fieldset>
  );
}

export function DriveFields({
  values,
  onChange,
  disabled = false,
}: {
  values: DriveFieldValues;
  onChange: (key: keyof DriveFieldValues, value: string) => void;
  disabled?: boolean;
}) {
  const [roles, setRoles] = useState<{ id: string; title: string }[]>([]);
  const [cities, setCities] = useState<{ id: string; name: string; state: string }[]>([]);

  useEffect(() => {
    apiClient.listRoles().then(setRoles);
    apiClient.listCities().then(setCities);
  }, []);

  const input = (key: keyof DriveFieldValues) => ({
    value: values[key],
    onChange: (e: { target: { value: string } }) => onChange(key, e.target.value),
    disabled,
  });

  return (
    <>
      <FieldGroup legend="Role and venue">
        <BoardField label="Role">
          <BoardSelect {...input("roleId")}>
            <option value="">Choose a role</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.title}
              </option>
            ))}
          </BoardSelect>
        </BoardField>
        <BoardField label="City">
          <BoardSelect {...input("cityId")}>
            <option value="">Choose a city</option>
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}, {city.state}
              </option>
            ))}
          </BoardSelect>
        </BoardField>
        <BoardField label="Venue address" hint="The street address candidates will walk to." className="sm:col-span-2">
          <BoardInput autoComplete="street-address" {...input("venueAddress")} />
        </BoardField>
      </FieldGroup>

      <FieldGroup legend="Pay and experience">
        <BoardField label="Pay from (₹)">
          <BoardInput board type="number" inputMode="numeric" min={0} {...input("salaryMin")} />
        </BoardField>
        <BoardField label="Pay up to (₹)">
          <BoardInput board type="number" inputMode="numeric" min={0} {...input("salaryMax")} />
        </BoardField>
        <BoardField label="Experience from (years)">
          <BoardInput board type="number" inputMode="decimal" min={0} step={0.5} {...input("experienceMin")} />
        </BoardField>
        <BoardField label="Experience up to (years)">
          <BoardInput board type="number" inputMode="decimal" min={0} step={0.5} {...input("experienceMax")} />
        </BoardField>
      </FieldGroup>

      <FieldGroup legend="When">
        <BoardField label="Doors open">
          <BoardInput board type="datetime-local" {...input("startsAt")} />
        </BoardField>
        <BoardField label="Doors close">
          <BoardInput board type="datetime-local" {...input("endsAt")} />
        </BoardField>
      </FieldGroup>
    </>
  );
}
