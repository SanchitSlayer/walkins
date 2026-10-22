import { z } from "zod";
import { personRefSchema } from "./people";

export const MESSAGE_MAX_LENGTH = 1000;

// A thread stops taking messages this long after its drive ends: long enough
// for an offer letter or a "why not me", short enough that a company can't
// keep a channel to someone it met once.
export const THREAD_CLOSES_AFTER_DAYS = 30;

export const sendMessageSchema = z.object({ body: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH) });

export const markReadSchema = z.object({ seq: z.number().int().nonnegative() });

// Why a side can't send, in the order a page should mention them: the
// permanent reasons before the temporary ones.
export const threadBlockSchema = z.enum(["closed", "applicationClosed", "companySuspended", "driveSuspended", "viewOnly"]);

export const messageDeliverySchema = z.enum(["telegram", "pending", "failed", "inAppOnly"]);

export const threadMessageSchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  side: z.enum(["COMPANY", "CANDIDATE"]),
  // Who at the company wrote it; null for the candidate's own messages.
  sender: personRefSchema.nullable(),
  body: z.string(),
  moneyFlag: z.boolean(),
  createdAt: z.string(),
  // How the company's message reached the candidate outside the app. Only
  // the company sees it.
  delivery: messageDeliverySchema.nullable(),
});

export const threadSchema = z.object({
  applicationId: z.string(),
  drive: z.object({ id: z.string(), roleTitle: z.string(), companyName: z.string(), startsAt: z.string(), endsAt: z.string() }),
  candidateName: z.string(),
  canSend: z.boolean(),
  blockedBy: z.array(threadBlockSchema),
  closesAt: z.string(),
  // Company side only: whether a message can reach the candidate before they
  // next open the app, and who at the company read the thread last.
  telegramLinked: z.boolean().nullable(),
  lastReadBy: z.object({ person: personRefSchema, at: z.string() }).nullable(),
  unread: z.number().int(),
  messages: z.array(threadMessageSchema),
});

export const threadSummarySchema = z.object({
  applicationId: z.string(),
  driveId: z.string(),
  roleTitle: z.string(),
  companyName: z.string(),
  candidateName: z.string(),
  lastMessageAt: z.string(),
  unread: z.number().int(),
});

export const threadListSchema = z.object({
  threads: z.array(threadSummarySchema),
  unread: z.number().int(),
});

// For a company's owner: messages from their own people that the tripwire
// flagged, so a rogue recruiter is visible inside the company, not only to
// Walkins.
export const flaggedMessageSchema = z.object({
  messageId: z.string(),
  applicationId: z.string(),
  driveId: z.string(),
  roleTitle: z.string(),
  candidateName: z.string(),
  sender: personRefSchema,
  body: z.string(),
  createdAt: z.string(),
});

export type FlaggedMessage = z.infer<typeof flaggedMessageSchema>;
export type MessageDelivery = z.infer<typeof messageDeliverySchema>;
export type SendMessage = z.infer<typeof sendMessageSchema>;
export type Thread = z.infer<typeof threadSchema>;
export type ThreadBlock = z.infer<typeof threadBlockSchema>;
export type ThreadList = z.infer<typeof threadListSchema>;
export type ThreadMessage = z.infer<typeof threadMessageSchema>;

// A tripwire, not a guard. It catches the common wording of a fee demand
// (a UPI handle, a bank account or IFSC, a payment app, a fee word next to an
// amount, in English, Hinglish and Devanagari) so the warning is shouted when
// it most matters. It does not screen messages: "send me 500 on the number
// you have" passes it completely. The never-pay band and the report route
// are the protection; this only decides when to raise the alarm. A salary
// on its own is not flagged; a salary next to "deposit" may be, and that is
// accepted, because a flag only adds a warning.
const SIGNALS: [string, RegExp][] = [
  ["upiHandle", /(^|[\s:(])[\w.-]{2,}@[a-z]{2,}(?![\w.])/i],
  ["ifsc", /\b[A-Z]{4}0[A-Z0-9]{6}\b/],
  ["accountNumber", /\b(a\/c|acct|account|khata)\b[^\n]{0,20}\d{9,18}/i],
  ["paymentApp", /\b(upi|paytm|g\s?pay|google\s?pay|phone\s?pe|bhim|razorpay\.me|paytm\.me)\b/i],
  [
    "feeWithAmount",
    /(\b(fee|fees|registration|deposit|security|advance|charges?|processing|refundable|uniform|training|kit|transfer|bhejo|bhej|jama|paise|paisa|rupaye)\b|फीस|शुल्क|जमा|पैसे|रुपये|भेजो|भेजें|रजिस्ट्रेशन)[^\n]{0,40}(₹|\brs\.?|\binr\b|\d{3,})|(₹|\brs\.?|\binr\b)\s?\d[\d,]*[^\n]{0,40}(\b(fee|fees|registration|deposit|advance|charges?|jama|bhejo)\b|फीस|शुल्क|जमा)/i,
  ],
];

export function moneyRequestSignals(text: string): string[] {
  return SIGNALS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
