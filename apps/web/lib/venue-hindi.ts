import { createTranslator } from "next-intl";
import { MESSAGES, OFFERED_LOCALES } from "@walkins/shared";

// The venue's screens (check-in and arrivals) are served from the employer's
// English-only addresses, but they face a queue, and nobody in it chose that
// language. Once Hindi is offered they show it too, each in its own way.
export const venueHindi = OFFERED_LOCALES.includes("hi") ? createTranslator({ locale: "hi", messages: MESSAGES.hi }) : null;
