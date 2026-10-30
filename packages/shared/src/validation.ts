import { type ZodErrorMap, type ZodIssue, ZodIssueCode, z } from "zod";
import { INTL_LOCALE, isMessageKey, type Locale, type MessageKey, type MessageValues } from "./i18n";

// Validation messages are catalog keys, never zod's developer wording
// ("Number must be greater than or equal to 1"). A schema's own message is
// written as a key ("errors.validation.payRange"); every built-in issue gets
// one here. issueText() turns either into words with whichever translator
// the caller has: translate() in the API, next-intl's t() in the web app.
function keyFor(issue: Parameters<ZodErrorMap>[0]): MessageKey {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === "undefined" || issue.received === "null") return "errors.validation.required";
      if (issue.expected === "integer") return "errors.validation.integer";
      return issue.expected === "number" ? "errors.validation.number" : "errors.validation.generic";
    case ZodIssueCode.too_small:
      // An empty required text field is missing, not "too short".
      if (issue.type === "string") return Number(issue.minimum) <= 1 ? "errors.validation.required" : "errors.validation.tooShort";
      if (issue.type === "array") return "errors.validation.tooFew";
      return issue.inclusive ? "errors.validation.tooLow" : "errors.validation.tooLowExclusive";
    case ZodIssueCode.too_big:
      if (issue.type === "string") return "errors.validation.tooLong";
      if (issue.type === "array") return "errors.validation.tooMany";
      return issue.inclusive ? "errors.validation.tooHigh" : "errors.validation.tooHighExclusive";
    case ZodIssueCode.invalid_string:
    case ZodIssueCode.invalid_date:
      return "errors.validation.format";
    case ZodIssueCode.invalid_enum_value:
    case ZodIssueCode.invalid_union_discriminator:
    case ZodIssueCode.invalid_literal:
      return "errors.validation.choice";
    case ZodIssueCode.not_finite:
      return "errors.validation.number";
    default:
      return "errors.validation.generic";
  }
}

const errorMap: ZodErrorMap = (issue) => ({ message: keyFor(issue) });
z.setErrorMap(errorMap);

export type Translator = (key: MessageKey, values?: MessageValues) => string;

export type IssueError = { key: MessageKey; values: MessageValues; field: string; fieldKey: MessageKey };

export function describeIssue(issue: ZodIssue): IssueError {
  const key = isMessageKey(issue.message) ? issue.message : "errors.validation.generic";
  const field = [...issue.path].reverse().find((p): p is string => typeof p === "string") ?? "";
  const fieldKey = `fields.${field}`;
  const values: MessageValues = {};
  if ("minimum" in issue) values.minimum = Number(issue.minimum);
  if ("maximum" in issue) values.maximum = Number(issue.maximum);
  return { key, values, field: issue.path.join("."), fieldKey: isMessageKey(fieldKey) ? fieldKey : "fields.default" };
}

export function issueText(issue: ZodIssue, t: Translator): string {
  const { key, values, fieldKey } = describeIssue(issue);
  return t(key, { ...values, field: t(fieldKey) });
}

// A refusal names its fields by key ("fields.homeLat"), never in words, so
// the reader's side words them: the web app in the page's language, the API
// in English for any other client. A list of fields is joined the way the
// language joins one, except that Hindi drops the comma CLDR puts before और
// ("A, B, और C"), as everyday writing does. Only fields. keys are worded:
// other values can be an employer's own text.
export type ErrorValues = Record<string, string | number | Date | MessageKey[]>;

export function wordFields(values: ErrorValues, t: Translator, locale: Locale): MessageValues {
  const list = new Intl.ListFormat(INTL_LOCALE[locale], { type: "conjunction" });
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => {
      if (Array.isArray(value)) return [name, list.format(value.map((key) => t(key))).replace(", और ", " और ")];
      return [name, typeof value === "string" && value.startsWith("fields.") && isMessageKey(value) ? t(value) : value];
    }),
  );
}
