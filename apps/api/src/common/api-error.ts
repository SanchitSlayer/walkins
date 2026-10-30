import { DEFAULT_LOCALE, type ErrorValues, type MessageKey, translate, wordFields } from "@walkins/shared";

export type ApiErrorBody = { code: MessageKey; message: string; params?: ErrorValues; field?: string; [extra: string]: unknown };

// The body of every refusal the API gives a person: a catalog key the web
// app translates in the reader's language, the default-locale wording for
// any other client, and the values the wording needs. Pass it to a Nest
// exception: new BadRequestException(apiError("errors.drive.notFound")).
export function apiError(code: MessageKey, params?: ErrorValues, extra?: Record<string, unknown>): ApiErrorBody {
  const english = (key: MessageKey, values?: Parameters<typeof translate>[2]) => translate(DEFAULT_LOCALE, key, values);
  return { code, message: english(code, params && wordFields(params, english, DEFAULT_LOCALE)), ...(params ? { params } : {}), ...extra };
}
