import { z } from "zod";
import { personRefSchema } from "./people";

// How long after the joining date (or the hire, when no date was agreed)
// either side may still record or correct what happened.
export const OUTCOME_CORRECTION_DAYS = 60;

// "Still there" is asked this long after the start, never sooner.
export const RETENTION_DAYS = 30;

const DAY_MS = 24 * 3600_000;

// A calendar day in India, as people agree a joining date.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "errors.validation.date");

// Only the fields being set are sent; null clears a fact back to unknown.
export const recordOutcomeSchema = z.object({
  joiningDate: day.nullable().optional(),
  started: z.boolean().nullable().optional(),
  startedOn: day.optional(),
  retained: z.boolean().nullable().optional(),
});

export const candidateAnswerSchema = z.object({ started: z.boolean() });

export const outcomeNeedSchema = z.enum(["joiningDate", "started", "retained"]);

export const outcomeRowSchema = z.object({
  applicationId: z.string(),
  driveId: z.string(),
  roleTitle: z.string(),
  candidateName: z.string(),
  driveStartsAt: z.string(),
  hiredAt: z.string(),
  joiningDate: z.string().nullable(),
  joiningDateBy: personRefSchema.nullable(),
  started: z.boolean().nullable(),
  startedOn: z.string().nullable(),
  startedBy: personRefSchema.nullable(),
  retained: z.boolean().nullable(),
  retainedBy: personRefSchema.nullable(),
  // The candidate's own answer, so the employer can see one exists.
  candidateStarted: z.boolean().nullable(),
  candidateAnsweredAt: z.string().nullable(),
  // What is waiting to be recorded now, if anything.
  need: outcomeNeedSchema.nullable(),
  editableUntil: z.string(),
});

export const outcomesSchema = z.object({
  due: z.number().int(),
  rows: z.array(outcomeRowSchema),
});

export type CandidateAnswer = z.infer<typeof candidateAnswerSchema>;
export type OutcomeNeed = z.infer<typeof outcomeNeedSchema>;
export type OutcomeRow = z.infer<typeof outcomeRowSchema>;
export type Outcomes = z.infer<typeof outcomesSchema>;
export type RecordOutcome = z.infer<typeof recordOutcomeSchema>;

export function addDays(dayKey: string, days: number): string {
  return new Date(new Date(`${dayKey}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

// The one rule for what the employer is asked next, in the order it can be
// known: when they start, whether they did, whether they stayed. A question
// is only due once its answer could exist.
export function outcomeNeed(
  o: { joiningDate: string | null; started: boolean | null; startedOn: string | null; retained: boolean | null },
  today: string,
): OutcomeNeed | null {
  if (o.started === null && o.joiningDate === null) return "joiningDate";
  if (o.started === null) return o.joiningDate! <= today ? "started" : null;
  if (o.started && o.retained === null && o.startedOn && addDays(o.startedOn, RETENTION_DAYS) <= today) return "retained";
  return null;
}

// What a candidate sees about themselves: every drive they applied to and
// what was recorded, and after a hire, each fact with who it came from. It
// is its own shape so nothing else can travel in it: no reporters, no
// employer notes or shortlists, no match scores, no reliability number
// (nothing uses one yet), nobody else's anything.
export const recordEntryStateSchema = z.enum([
  "booked",
  "attended",
  "awaitingConfirmation",
  "notAttended",
  // Marked absent from a drive that was moved without the notice reaching
  // them; not held against them, and the record says so.
  "notAttendedExcused",
  "withdrawn",
  "screenedOut",
  "turnedAway",
  "driveCancelled",
  "drivePaused",
]);

export const candidateRecordSchema = z.object({
  entries: z.array(
    z.object({
      applicationId: z.string(),
      roleTitle: z.string(),
      companyName: z.string(),
      driveStartsAt: z.string(),
      state: recordEntryStateSchema,
      // When the absence was recorded, for a not-attended entry.
      markedAbsentAt: z.string().nullable(),
      hired: z.boolean(),
      // After a hire: the employer's record (from the company) and the
      // candidate's own answer, side by side.
      after: z
        .object({
          joiningDate: z.string().nullable(),
          started: z.boolean().nullable(),
          startedOn: z.string().nullable(),
          retained: z.boolean().nullable(),
          yourAnswer: z.boolean().nullable(),
        })
        .nullable(),
    }),
  ),
});

export type CandidateRecord = z.infer<typeof candidateRecordSchema>;
export type RecordEntryState = z.infer<typeof recordEntryStateSchema>;
