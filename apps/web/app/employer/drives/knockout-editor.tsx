"use client";

import { type KnockoutQuestion, MAX_KNOCKOUT_QUESTIONS } from "@walkins/shared";
import { BoardButton, BoardField, BoardInput, BoardSelect } from "@/components/board/field";
import { FieldGroup } from "./drive-fields";

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

// Zod's own wording ("String must contain at least 3 character(s)") doesn't
// say which question it means.
export function driveIssue(issue: { path: (string | number)[]; message: string } | undefined): string {
  if (!issue) return "A field is missing or invalid";
  const [field, index, key] = issue.path;
  if (field !== "knockoutQuestions" || typeof index !== "number") return issue.message;
  const question = `Screening question ${index + 1}`;
  if (key === "prompt") return `${question} needs a question`;
  if (key === "requirement") return `${question} needs a requirement`;
  return `${question}: ${issue.message}`;
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
  const text = (key: "prompt" | "requirement" | "unit" | "min" | "max") => ({
    value: draft[key],
    onChange: (e: { target: { value: string } }) => onChange({ [key]: e.target.value }),
    disabled,
  });

  return (
    <>
      <BoardField label="Question" className="sm:col-span-2">
        <BoardInput placeholder="Do you have a two-wheeler licence?" {...text("prompt")} />
      </BoardField>
      <BoardField label="Answer type">
        <BoardSelect
          value={draft.type}
          onChange={(e) => onChange({ type: e.target.value as KnockoutDraft["type"] })}
          disabled={disabled}
        >
          <option value="BOOLEAN">Yes or no</option>
          <option value="NUMERIC">A number</option>
          <option value="SINGLE_CHOICE">One of a list</option>
        </BoardSelect>
      </BoardField>

      {draft.type === "BOOLEAN" && (
        <BoardField label="Who can book">
          <BoardSelect
            value={draft.equals ? "yes" : "no"}
            onChange={(e) => onChange({ equals: e.target.value === "yes" })}
            disabled={disabled}
          >
            <option value="yes">Those who answer yes</option>
            <option value="no">Those who answer no</option>
          </BoardSelect>
        </BoardField>
      )}

      {draft.type === "NUMERIC" && (
        <>
          <BoardField label="Unit (optional)">
            <BoardInput placeholder="years" {...text("unit")} />
          </BoardField>
          <BoardField label="At least">
            <BoardInput board type="number" inputMode="decimal" {...text("min")} />
          </BoardField>
          <BoardField label="At most">
            <BoardInput board type="number" inputMode="decimal" {...text("max")} />
          </BoardField>
        </>
      )}

      {draft.type === "SINGLE_CHOICE" && (
        <>
          <BoardField label="Answers, one per line" className="sm:col-span-2">
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
              <legend className="type-meta mb-1.5 text-housing-muted">Answers that can book</legend>
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
        label="Requirement, shown to anyone who doesn't meet it"
        hint="Candidates see this instead of a booking, so they know why and don't travel for nothing."
        className="sm:col-span-2"
      >
        <BoardInput placeholder="A valid two-wheeler licence" {...text("requirement")} />
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
  return (
    <FieldGroup legend="Screening questions">
      <p className="type-meta text-housing-muted sm:col-span-2">
        Up to {MAX_KNOCKOUT_QUESTIONS}, asked before a candidate books. Someone who doesn&apos;t meet one is told the
        requirement and gets no seat. Walk-ins without a booking skip these; screen them at the desk.
      </p>
      {drafts.map((draft, index) => (
        <div key={draft.id} className="grid gap-4 border border-housing-rule p-4 sm:col-span-2 sm:grid-cols-2">
          <div className="flex items-center justify-between sm:col-span-2">
            <span className="type-meta text-housing-muted">Question {index + 1}</span>
            {!disabled && (
              <BoardButton variant="quiet" onClick={() => onChange(drafts.filter((d) => d.id !== draft.id))}>
                Remove
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
            Add a question
          </BoardButton>
        </div>
      )}
    </FieldGroup>
  );
}
