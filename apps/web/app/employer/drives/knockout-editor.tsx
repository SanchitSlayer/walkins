"use client";

import { type KnockoutQuestion, MAX_KNOCKOUT_QUESTIONS } from "@walkins/shared";
import { BoardButton, BoardField, BoardInput, BoardSelect } from "@/components/board/field";
import { FieldGroup } from "./drive-fields";
import { useTranslations } from "next-intl";
import { useIssueText } from "@/lib/use-error-text";

// Numbers and options are held as typed text until the form is submitted, so
// a half-typed "1." or an empty line doesn't fight the person typing it.
export type KnockoutDraft = {
  id: string;
  type: KnockoutQuestion["type"];
  prompt: string;
  requirement: string;
  equals: boolean;
  unit: string;
  min: string;
  max: string;
  options: string;
  accepted: string[];
};

function newDraft(): KnockoutDraft {
  return {
    id: crypto.randomUUID().slice(0, 8),
    type: "BOOLEAN",
    prompt: "",
    requirement: "",
    equals: true,
    unit: "",
    min: "",
    max: "",
    options: "",
    accepted: [],
  };
}

function optionList(draft: KnockoutDraft): string[] {
  return draft.options
    .split("\n")
    .map((o) => o.trim())
    .filter(Boolean);
}

export function knockoutDrafts(questions: KnockoutQuestion[]): KnockoutDraft[] {
  return questions.map((q) => ({
    ...newDraft(),
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    requirement: q.requirement,
    ...(q.type === "BOOLEAN" && { equals: q.pass.equals }),
    ...(q.type === "NUMERIC" && {
      unit: q.unit ?? "",
      min: q.pass.min === undefined ? "" : String(q.pass.min),
      max: q.pass.max === undefined ? "" : String(q.pass.max),
    }),
    ...(q.type === "SINGLE_CHOICE" && { options: q.options.join("\n"), accepted: q.pass.accepted }),
  }));
}

// The result is checked by the drive schema on submit, which words what's
// missing.
export function knockoutQuestions(drafts: KnockoutDraft[]): KnockoutQuestion[] {
  return drafts.map((d): KnockoutQuestion => {
    const base = { id: d.id, prompt: d.prompt, requirement: d.requirement };
    if (d.type === "BOOLEAN") return { ...base, type: "BOOLEAN", pass: { equals: d.equals } };
    if (d.type === "NUMERIC") {
      return {
        ...base,
        type: "NUMERIC",
        ...(d.unit.trim() && { unit: d.unit.trim() }),
        pass: {
          ...(d.min !== "" && { min: Number(d.min) }),
          ...(d.max !== "" && { max: Number(d.max) }),
        },
      };
    }
    const options = optionList(d);
    return { ...base, type: "SINGLE_CHOICE", options, pass: { accepted: d.accepted.filter((a) => options.includes(a)) } };
  });
}

// The drive form's validation wording: the shared catalog's, plus which
// screening question it means when the problem is inside one.
export function useDriveIssue() {
  const t = useTranslations("knockouts");
  const issueText = useIssueText();
  return (issue: Parameters<typeof issueText>[0]) => {
    const [field, index] = issue.path;
    const problem = issueText(issue);
    return field === "knockoutQuestions" && typeof index === "number" ? t("issue", { n: index + 1, problem }) : problem;
  };
}

function QuestionFields({
  draft,
  onChange,
  disabled,
}: {
  draft: KnockoutDraft;
  onChange: (patch: Partial<KnockoutDraft>) => void;
  disabled: boolean;
}) {
  const t = useTranslations("knockouts");
  const text = (key: "prompt" | "requirement" | "unit" | "min" | "max") => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => onChange({ [key]: e.target.value }),
    disabled,
  });

  return (
    <>
      <BoardField label={t("question")} className="sm:col-span-2">
        <BoardInput placeholder={t("questionExample")} {...text("prompt")} />
      </BoardField>
      <BoardField label={t("answerType")}>
        <BoardSelect
          value={draft.type}
          onChange={(e) => onChange({ type: e.target.value as KnockoutDraft["type"] })}
          disabled={disabled}
        >
          <option value="BOOLEAN">{t("typeBoolean")}</option>
          <option value="NUMERIC">{t("typeNumber")}</option>
          <option value="SINGLE_CHOICE">{t("typeChoice")}</option>
        </BoardSelect>
      </BoardField>

      {draft.type === "BOOLEAN" && (
        <BoardField label={t("whoCanBook")}>
          <BoardSelect
            value={draft.equals ? "yes" : "no"}
            onChange={(e) => onChange({ equals: e.target.value === "yes" })}
            disabled={disabled}
          >
            <option value="yes">{t("answerYes")}</option>
            <option value="no">{t("answerNo")}</option>
          </BoardSelect>
        </BoardField>
      )}

      {draft.type === "NUMERIC" && (
        <>
          <BoardField label={t("unit")}>
            <BoardInput placeholder={t("unitExample")} {...text("unit")} />
          </BoardField>
          <BoardField label={t("atLeast")}>
            <BoardInput board type="number" inputMode="decimal" {...text("min")} />
          </BoardField>
          <BoardField label={t("atMost")}>
            <BoardInput board type="number" inputMode="decimal" {...text("max")} />
          </BoardField>
        </>
      )}

      {draft.type === "SINGLE_CHOICE" && (
        <>
          <BoardField label={t("answers")} className="sm:col-span-2">
            <textarea
              rows={3}
              className="type-body w-full border border-housing-rule bg-housing-raised px-3 py-2 text-stock [color-scheme:dark] disabled:opacity-60"
              value={draft.options}
              onChange={(e) => onChange({ options: e.target.value })}
              disabled={disabled}
            />
          </BoardField>
          {optionList(draft).length > 0 && (
            <fieldset className="grid gap-1.5 sm:col-span-2">
              <legend className="type-meta mb-1.5 text-housing-muted">{t("acceptedAnswers")}</legend>
              <div className="flex flex-wrap gap-2">
                {optionList(draft).map((option) => (
                  <label key={option} className="type-meta flex min-h-11 items-center gap-2 border border-housing-rule px-3">
                    <input
                      type="checkbox"
                      checked={draft.accepted.includes(option)}
                      onChange={(e) =>
                        onChange({
                          accepted: e.target.checked
                            ? [...draft.accepted, option]
                            : draft.accepted.filter((a) => a !== option),
                        })
                      }
                      disabled={disabled}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </>
      )}

      <BoardField
        label={t("requirement")}
        hint={t("requirementHint")}
        className="sm:col-span-2"
      >
        <BoardInput placeholder={t("requirementExample")} {...text("requirement")} />
      </BoardField>
    </>
  );
}

export function KnockoutEditor({
  drafts,
  onChange,
  disabled = false,
}: {
  drafts: KnockoutDraft[];
  onChange: (drafts: KnockoutDraft[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("knockouts");
  return (
    <FieldGroup legend={t("heading")}>
      <p className="type-meta text-housing-muted sm:col-span-2">{t("intro", { max: MAX_KNOCKOUT_QUESTIONS })}</p>
      {drafts.map((draft, index) => (
        <div key={draft.id} className="grid gap-4 border border-housing-rule p-4 sm:col-span-2 sm:grid-cols-2">
          <div className="flex items-center justify-between sm:col-span-2">
            <span className="type-meta text-housing-muted">{t("numbered", { n: index + 1 })}</span>
            {!disabled && (
              <BoardButton variant="quiet" onClick={() => onChange(drafts.filter((d) => d.id !== draft.id))}>
                {t("remove")}
              </BoardButton>
            )}
          </div>
          <QuestionFields
            draft={draft}
            disabled={disabled}
            onChange={(patch) => onChange(drafts.map((d) => (d.id === draft.id ? { ...d, ...patch } : d)))}
          />
        </div>
      ))}
      {!disabled && drafts.length < MAX_KNOCKOUT_QUESTIONS && (
        <div className="sm:col-span-2">
          <BoardButton variant="quiet" onClick={() => onChange([...drafts, newDraft()])}>
            {t("add")}
          </BoardButton>
        </div>
      )}
    </FieldGroup>
  );
}
