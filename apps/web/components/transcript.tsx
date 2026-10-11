import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";

// Shown with every transcript, wherever it appears: it is a machine's guess
// at what was said, and it must never read as a quote.
export function TranscriptLabel({
  language,
  languageProbability,
  className,
}: {
  language: string | null;
  languageProbability: number | null;
  className?: string;
}) {
  const t = useTranslations("transcript");
  const { languageName } = useFormat();
  return (
    <p className={cn("type-meta", className)}>
      {t("label")}
      {language &&
        (languageProbability !== null
          ? t("languageSure", { language: languageName(language), percent: Math.round(languageProbability * 100) })
          : t("language", { language: languageName(language) }))}
    </p>
  );
}
