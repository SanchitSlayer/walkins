import { z } from "zod";

// Pass/fail questions an employer sets on a drive, answered when applying.
// `requirement` is written by the employer for the candidate who doesn't meet
// it ("A valid two-wheeler licence"): it is what they are told, so they know
// why and don't travel for nothing.
const questionBase = {
  id: z.string().trim().min(1).max(40),
  prompt: z.string().trim().min(3).max(200),
  requirement: z.string().trim().min(3).max(200),
};

export const knockoutQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    ...questionBase,
    type: z.literal("BOOLEAN"),
    pass: z.object({ equals: z.boolean() }),
  }),
  z.object({
    ...questionBase,
    type: z.literal("NUMERIC"),
    unit: z.string().trim().max(20).optional(),
    pass: z
      .object({ min: z.number().optional(), max: z.number().optional() })
      .refine((p) => p.min !== undefined || p.max !== undefined, "Set a minimum, a maximum or both")
      .refine((p) => p.min === undefined || p.max === undefined || p.min <= p.max, "The minimum is above the maximum"),
  }),
  z.object({
    ...questionBase,
    type: z.literal("SINGLE_CHOICE"),
    options: z.array(z.string().trim().min(1).max(80)).min(2).max(8),
    pass: z.object({ accepted: z.array(z.string()).min(1) }),
  }),
]);

export const MAX_KNOCKOUT_QUESTIONS = 5;

export const knockoutQuestionsSchema = z
  .array(knockoutQuestionSchema)
  .max(MAX_KNOCKOUT_QUESTIONS)
  .superRefine((questions, ctx) => {
    if (new Set(questions.map((q) => q.id)).size !== questions.length) {
      ctx.addIssue({ code: "custom", message: "Each question needs its own id" });
    }
    questions.forEach((q, index) => {
      if (q.type === "SINGLE_CHOICE" && !q.pass.accepted.every((a) => q.options.includes(a))) {
        ctx.addIssue({ code: "custom", path: [index, "pass"], message: "An accepted answer isn't one of the options" });
      }
    });
  });

export const knockoutAnswersSchema = z.record(z.string(), z.union([z.boolean(), z.number(), z.string()]));

export type KnockoutQuestion = z.infer<typeof knockoutQuestionSchema>;
export type KnockoutAnswers = z.infer<typeof knockoutAnswersSchema>;

// What a candidate is shown before applying: the questions, never the pass
// conditions or requirements, so the right answers aren't handed out.
export const publicKnockoutQuestionSchema = z.object({
  id: z.string(),
  type: z.enum(["BOOLEAN", "NUMERIC", "SINGLE_CHOICE"]),
  prompt: z.string(),
  unit: z.string().optional(),
  options: z.array(z.string()).optional(),
});

export type PublicKnockoutQuestion = z.infer<typeof publicKnockoutQuestionSchema>;

export function publicKnockoutQuestions(questions: KnockoutQuestion[]): PublicKnockoutQuestion[] {
  return questions.map((q) => ({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    ...(q.type === "NUMERIC" && q.unit ? { unit: q.unit } : {}),
    ...(q.type === "SINGLE_CHOICE" ? { options: q.options } : {}),
  }));
}

export type KnockoutResult =
  | { passed: true }
  | { passed: false; questionId: string; reason: string }
  | { passed: false; questionId: string; invalid: string };

// "invalid" is a malformed answer (missing, wrong type, not an option): a 400
// for the request, not a judgement on the candidate. Otherwise the first unmet
// requirement is the reason, worded by the employer.
export function evaluateKnockouts(questions: KnockoutQuestion[], answers: KnockoutAnswers): KnockoutResult {
  for (const q of questions) {
    const answer = answers[q.id];
    if (answer === undefined) return { passed: false, questionId: q.id, invalid: `Answer "${q.prompt}"` };
    switch (q.type) {
      case "BOOLEAN":
        if (typeof answer !== "boolean") return { passed: false, questionId: q.id, invalid: `"${q.prompt}" needs a yes or no` };
        if (answer !== q.pass.equals) return { passed: false, questionId: q.id, reason: q.requirement };
        break;
      case "NUMERIC":
        if (typeof answer !== "number" || !Number.isFinite(answer)) {
          return { passed: false, questionId: q.id, invalid: `"${q.prompt}" needs a number` };
        }
        if ((q.pass.min !== undefined && answer < q.pass.min) || (q.pass.max !== undefined && answer > q.pass.max)) {
          return { passed: false, questionId: q.id, reason: q.requirement };
        }
        break;
      case "SINGLE_CHOICE":
        if (typeof answer !== "string" || !q.options.includes(answer)) {
          return { passed: false, questionId: q.id, invalid: `Choose one of the answers to "${q.prompt}"` };
        }
        if (!q.pass.accepted.includes(answer)) return { passed: false, questionId: q.id, reason: q.requirement };
        break;
    }
  }
  return { passed: true };
}
