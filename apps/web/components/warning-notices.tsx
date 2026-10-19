"use client";

import { useState } from "react";
import type { Warning } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton } from "@/components/board/field";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/lib/use-error-text";

// A warning is a notice, not a penalty: it says what was reported and that
// nothing has been taken away, and it stays until someone has read it.
export function WarningNotices({
  warnings,
  audience,
  onAcknowledged,
}: {
  warnings: Warning[];
  audience: "company" | "candidate";
  onAcknowledged: () => void;
}) {
  const t = useTranslations("warning");
  const errorText = useErrorText();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function acknowledge(id: string) {
    setBusy(id);
    setError(null);
    try {
      await apiClient.acknowledgeWarning(id);
      onAcknowledged();
    } catch (err) {
      setError(errorText(err, "errors.generic"));
    } finally {
      setBusy(null);
    }
  }

  if (warnings.length === 0) return null;
  return (
    <div className="grid gap-3">
      {warnings.map((w) => (
        <section key={w.id} aria-label={t("heading")} className="grid gap-2 border-l-4 border-pending-lamp bg-housing-raised p-4 text-stock">
          <h2 className="type-h3">{t("heading")}</h2>
          <p className="type-body">{t(audience, { reason: w.reason })}</p>
          {w.note && <p className="type-meta">{t("note", { note: w.note })}</p>}
          <div>
            <BoardButton variant="quiet" className="min-h-9 px-3" disabled={busy !== null} onClick={() => acknowledge(w.id)}>
              {t("acknowledge")}
            </BoardButton>
          </div>
        </section>
      ))}
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
    </div>
  );
}
