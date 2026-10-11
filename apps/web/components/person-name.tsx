"use client";

import type { PersonRef } from "@walkins/shared";
import { useTranslations } from "next-intl";

// A colleague named on a record. Someone who has left keeps their name
// there, marked as gone, so the record still says who did it.
export function usePersonName(): (person: PersonRef) => string {
  const t = useTranslations("people");
  return (person) => (person.current ? person.name : t("left", { name: person.name }));
}

export function PersonName({ person }: { person: PersonRef }) {
  return <>{usePersonName()(person)}</>;
}
