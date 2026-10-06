"use client";

import { useCallback, useEffect, useState } from "react";
import { type AdminCompany, formatPaise, type VerificationOutcome } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton } from "@/components/board/field";
import { cn } from "@/lib/utils";

const STATUS_CLASS: Record<AdminCompany["verificationStatus"], string> = {
  PENDING: "text-pending-lamp",
  VERIFIED: "text-live-lamp",
  REJECTED: "text-closing-lamp",
};

export default function VerificationPage() {
  const [companies, setCompanies] = useState<AdminCompany[] | null>(null);
  const [last, setLast] = useState<VerificationOutcome | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setCompanies(await apiClient.adminCompanies()), []);
  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Couldn't load companies"));
  }, [load]);

  async function decide(company: AdminCompany, decision: "check" | "reject") {
    let reason: string | undefined;
    if (decision === "reject") {
      const given = prompt(`Reject ${company.name}? Give the reason they'll need to fix it.`);
      if (given === null) return;
      reason = given.trim() || undefined;
    }
    setBusy(company.id);
    setError(null);
    try {
      setLast(await apiClient.adminVerifyCompany(company.id, { decision, reason }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="type-h2">Company verification</h1>
        <p className="type-meta mt-1 text-housing-muted">
          &ldquo;Check&rdquo; asks the verification provider and applies its answer. The provider here is a mock that
          only checks the GSTIN is well formed; it looks nothing up. A drive can&apos;t go live for an unverified company.
        </p>
      </div>
      {last?.provider && (
        <p role="status" className="type-meta border-l-4 border-pending-lamp bg-housing-raised p-3">
          {last.company.name}: {last.provider.name} said {last.provider.status.toLowerCase()}, &ldquo;{last.provider.reason}&rdquo;.
        </p>
      )}
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      {!companies ? (
        <p role="status" className="type-meta text-housing-muted">
          Loading companies
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-left">
            <thead>
              <tr className="type-meta border-b border-housing-rule text-housing-muted">
                <th className="py-2 pr-4 font-normal">Company</th>
                <th className="py-2 pr-4 font-normal">GSTIN</th>
                <th className="py-2 pr-4 font-normal">Status</th>
                <th className="py-2 pr-4 text-right font-normal">Balance</th>
                <th className="py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="type-meta border-b border-housing-line">
                  <td className="py-2 pr-4">
                    {c.name}
                    <span className="text-housing-muted">
                      {" "}
                      · {c.cityName} · {c.contactPhone}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-mono">{c.gstin ?? <span className="text-housing-muted">none</span>}</td>
                  <td className={cn("py-2 pr-4", STATUS_CLASS[c.verificationStatus])}>{c.verificationStatus.toLowerCase()}</td>
                  <td className={cn("type-board-md py-2 pr-4 text-right", c.balancePaise < 0 && "text-closing-lamp")}>
                    {formatPaise(c.balancePaise)}
                  </td>
                  <td className="py-2">
                    <div className="flex justify-end gap-2">
                      <BoardButton className="min-h-9 px-3" disabled={busy === c.id} onClick={() => decide(c, "check")}>
                        Check
                      </BoardButton>
                      <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy === c.id} onClick={() => decide(c, "reject")}>
                        Reject
                      </BoardButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
