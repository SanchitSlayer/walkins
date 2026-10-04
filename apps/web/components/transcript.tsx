import { languageName } from "@walkins/shared";
import { cn } from "@/lib/utils";

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
  return (
    <p className={cn("type-meta", className)}>
      Automatic transcript, may contain errors
      {language && (
        <>
          {" "}
          · {languageName(language)}
          {languageProbability !== null && ` (${Math.round(languageProbability * 100)}% sure of the language)`}
        </>
      )}
    </p>
  );
}
