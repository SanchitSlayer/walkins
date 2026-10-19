"use client";

import Link from "next/link";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { type CompanyStanding, UNVERIFIED_ALERT_LIMIT } from "@walkins/shared";
import { apiClient } from "./api-client";
import { useMembership } from "./membership";
import { WarningNotices } from "@/components/warning-notices";
import { useTranslations } from "next-intl";

type StandingContext = { standing: CompanyStanding | null; reload: () => Promise<void> };

const Context = createContext<StandingContext>({ standing: null, reload: async () => {} });

export function useStanding(): StandingContext {
  return useContext(Context);
}

// What every page of the desk should say about the company itself before
// anything else: suspended, a warning to read, or verification that limits
// or blocks its drives. An employer whose reach is limited is told so, and
// why, here rather than left to wonder at a quiet drive.
export function StandingNotices({ children }: { children: ReactNode }) {
  const t = useTranslations("standing");
  const { membership, can } = useMembership();
  const [standing, setStanding] = useState<CompanyStanding | null>(null);
  const reload = useCallback(async () => setStanding(await apiClient.getStanding()), []);

  useEffect(() => {
    reload();
  }, [reload]);

  const company = membership.company.name;
  const status = standing?.verificationStatus;
  return (
    <Context.Provider value={{ standing, reload }}>
      {standing && (
        <div className="mb-6 grid gap-3">
          {standing.suspended && (
            <section role="status" className="grid gap-1 border-l-4 border-closing-lamp bg-housing-raised p-4">
              <h2 className="type-h3">{t("suspendedHeading", { company })}</h2>
              <p className="type-body">{t("suspendedBody")}</p>
            </section>
          )}
          <WarningNotices warnings={standing.warnings} audience="company" onAcknowledged={reload} />
          {!standing.suspended && status !== "VERIFIED" && (
            <section className="grid gap-1 border-l-4 border-pending-lamp bg-housing-raised p-4">
              <p className="type-body">
                {status === "PENDING" ? t("limited", { company, limit: UNVERIFIED_ALERT_LIMIT }) : status === "REJECTED" ? t("rejected", { company }) : t("unsubmitted", { company })}
              </p>
              <Link href="/employer/verification" className="type-meta underline underline-offset-4">
                {can("manageCompany") && status !== "PENDING" ? t("verifyNow") : t("seeVerification")}
              </Link>
            </section>
          )}
        </div>
      )}
      {children}
    </Context.Provider>
  );
}
