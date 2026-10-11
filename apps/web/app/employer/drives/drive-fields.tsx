"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { DriveSummary } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardField, BoardInput, BoardSelect } from "@/components/board/field";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";

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

// venuePinnedAt is passed on the edit page: a pinned venue is replaced by
// the address's geocode as soon as the address changes, and the employer
// should know that before they type.
export function DriveFields({
  values,
  onChange,
  disabled = false,
  venuePinnedAt = null,
}: {
  values: DriveFieldValues;
  onChange: (key: keyof DriveFieldValues, value: string) => void;
  disabled?: boolean;
  venuePinnedAt?: string | null;
}) {
  const t = useTranslations("driveForm");
  const { dayLabel, formatTime } = useFormat();
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
      <FieldGroup legend={t("roleVenue")}>
        <BoardField label={t("role")}>
          <BoardSelect {...input("roleId")}>
            <option value="">{t("chooseRole")}</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.title}
              </option>
            ))}
          </BoardSelect>
        </BoardField>
        <BoardField label={t("city")}>
          <BoardSelect {...input("cityId")}>
            <option value="">{t("chooseCity")}</option>
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {t("cityState", { city: city.name, state: city.state })}
              </option>
            ))}
          </BoardSelect>
        </BoardField>
        <BoardField
          label={t("venueAddress")}
          hint={
            venuePinnedAt
              ? t("pinnedHint", { day: dayLabel(new Date(venuePinnedAt), new Date()), time: formatTime(venuePinnedAt) })
              : t("addressHint")
          }
          className="sm:col-span-2"
        >
          <BoardInput autoComplete="street-address" {...input("venueAddress")} />
        </BoardField>
      </FieldGroup>

      <FieldGroup legend={t("payExperience")}>
        <BoardField label={t("payFrom")}>
          <BoardInput board type="number" inputMode="numeric" min={0} {...input("salaryMin")} />
        </BoardField>
        <BoardField label={t("payTo")}>
          <BoardInput board type="number" inputMode="numeric" min={0} {...input("salaryMax")} />
        </BoardField>
        <BoardField label={t("experienceFrom")}>
          <BoardInput board type="number" inputMode="decimal" min={0} step={0.5} {...input("experienceMin")} />
        </BoardField>
        <BoardField label={t("experienceTo")}>
          <BoardInput board type="number" inputMode="decimal" min={0} step={0.5} {...input("experienceMax")} />
        </BoardField>
      </FieldGroup>

      <FieldGroup legend={t("when")}>
        <BoardField label={t("doorsOpen")}>
          <BoardInput board type="datetime-local" {...input("startsAt")} />
        </BoardField>
        <BoardField label={t("doorsClose")}>
          <BoardInput board type="datetime-local" {...input("endsAt")} />
        </BoardField>
      </FieldGroup>
    </>
  );
}
