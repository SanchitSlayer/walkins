import { DEFAULT_LOCALE, type MessageKey, type MessageValues, translate } from "@walkins/shared";

export type ApiErrorBody = { code: MessageKey; message: string; params?: MessageValues; field?: string; [extra: string]: unknown };

// The body of every refusal the API gives a person: a catalog key the web
// app translates in the reader's language, the default-locale wording for
// any other client, and the values the wording needs. Pass it to a Nest
// exception: new BadRequestException(apiError("errors.drive.notFound")).
export function apiError(code: MessageKey, params?: MessageValues, extra?: Record<string, unknown>): ApiErrorBody {
  return { code, message: translate(DEFAULT_LOCALE, code, params), ...(params ? { params } : {}), ...extra };
}
