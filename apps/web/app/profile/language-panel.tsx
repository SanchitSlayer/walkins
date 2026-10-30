"use client";

import { useState } from "react";
import { OFFERED_LOCALES } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { readIn, usePageLocale } from "@/lib/navigation";
import { BoardButton } from "@/components/board/field";
import { Slab } from "@/components/board/slab";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/lib/use-error-text";

// The remembered choice, which can differ from the page in front of them: a
// /hi link someone shared opens in Hindi for anyone. Shown only once a
// second language covers everything a candidate reads.
export function LanguagePanel() {
  const t = useTranslations("language");
  const errorText = useErrorText();
  const pageLocale = usePageLocale();
  const saved = apiClient.getSavedLocale() ?? pageLocale;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (OFFERED_LOCALES.length === 1) return null;

  async function choose(locale: (typeof OFFERED_LOCALES)[number]) {
    setPending(true);
    setError(null);
    try {
      await readIn(locale);
    } catch (err) {
      setError(errorText(err, "language.saveFailed"));
      setPending(false);
    }
  }

  return (
    <Slab depth="md" className="grid w-full gap-4 p-5">
      <div>
        <h2 className="type-h3">{t("heading")}</h2>
        <p className="type-meta mt-1 text-ink-muted">{t("intro")}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        {OFFERED_LOCALES.map((locale) => (
          <BoardButton
            key={locale}
            lang={locale}
            surface="stock"
            variant={locale === saved ? "primary" : "quiet"}
            aria-pressed={locale === saved}
            disabled={pending}
            onClick={() => locale !== saved && choose(locale)}
          >
            {t(`name.${locale}`)}
          </BoardButton>
        ))}
      </div>
      {/* Hindi is offered once it is complete, whether or not anyone has read
          it, so this line is the only place a reader learns how far it was
          checked. It stays, saying exactly that, until a native reading has
          happened. */}
      <p className="type-meta text-ink-muted">{t("hindiReview")}</p>
      {error && (
        <p role="alert" className="type-meta text-closing-ink">
          {error}
        </p>
      )}
    </Slab>
  );
}
