"use client";

import { useTranslations } from "next-intl";
import { isMessageKey, issueText, type MessageKey } from "@walkins/shared";

type Issue = Parameters<typeof issueText>[0];
import { ApiError } from "./api-client";
import { isNetworkError } from "./offline";

// Turns whatever a request threw into words in the page's language: the
// API's own refusal by its catalog code, no connection as no connection,
// and anything else as the fallback the caller names for what it was doing.
export function useErrorText(): (err: unknown, fallback: MessageKey) => string {
  const t = useTranslations();
  return (err, fallback) => {
    if (err instanceof ApiError && isMessageKey(err.code)) return t(err.code as MessageKey, err.params as never);
    if (isNetworkError(err)) return t("errors.network");
    return t(fallback);
  };
}

// The same words for a form checked in the browser before it is sent as the
// API gives when it checks it: one validation catalog, either side.
export function useIssueText(): (issue: Issue) => string {
  const t = useTranslations();
  return (issue) => issueText(issue, (key, values) => t(key, values as never));
}
