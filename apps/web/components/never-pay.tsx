"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// Fake recruiters charge "registration fees". This sits wherever a candidate
// reads about a job, the same everywhere, so it is never something they
// have to go looking for.
export function NeverPay({ reportHref, className }: { reportHref?: string; className?: string }) {
  const t = useTranslations("neverPay");
  return (
    <aside aria-labelledby="never-pay-heading" className={cn("grid gap-1 border-l-4 border-closing-lamp bg-housing-raised p-4 text-stock", className)}>
      <h2 id="never-pay-heading" className="type-h3">
        {t("heading")}
      </h2>
      <p className="type-body">{t("body")}</p>
      {reportHref ? (
        <a href={reportHref} className="type-meta underline underline-offset-4">
          {t("report")}
        </a>
      ) : (
        <p className="type-meta text-housing-muted">{t("howToReport")}</p>
      )}
    </aside>
  );
}
