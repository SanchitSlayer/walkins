"use client";

import Link from "next/link";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { type CompanyPermission, companyCan, type Membership } from "@walkins/shared";
import { ApiError, apiClient } from "./api-client";
import { useErrorText } from "./use-error-text";

type MembershipContext = { membership: Membership; can: (permission: CompanyPermission) => boolean };

const Context = createContext<MembershipContext | null>(null);

// The person's place in their company, from the server rather than the
// access token, so a role changed a minute ago shows here on the next page.
// Pages hide what the role can't do using the same table the API enforces;
// the API refuses it regardless.
export function useMembership(): MembershipContext {
  const value = useContext(Context);
  if (!value) throw new Error("useMembership outside MembershipGate");
  return value;
}

export function MembershipGate({ children }: { children: ReactNode }) {
  const t = useTranslations("people.gate");
  const errorText = useErrorText();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [problem, setProblem] = useState<unknown>(null);

  useEffect(() => {
    apiClient.getMembership().then(setMembership, setProblem);
  }, []);

  if (problem !== null) {
    const noCompany = problem instanceof ApiError && problem.code === "errors.auth.noCompany";
    return (
      <div className="grid max-w-xl gap-3 border-l-4 border-closing-lamp bg-housing-raised p-4">
        <h1 className="type-h3">{noCompany ? t("noCompanyHeading") : t("failedHeading")}</h1>
        <p className="type-body">{errorText(problem, "people.gate.failed")}</p>
        {noCompany && (
          <Link href="/join" className="type-meta underline underline-offset-4">
            {t("checkInvitations")}
          </Link>
        )}
      </div>
    );
  }
  if (!membership) return <p className="type-meta text-housing-muted">{t("loading")}</p>;

  return <Context.Provider value={{ membership, can: (p) => companyCan(membership.role, p) }}>{children}</Context.Provider>;
}
