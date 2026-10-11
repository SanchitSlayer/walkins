import type { Locale, Messages } from "@walkins/shared";

// Makes every t("…") key and its values type-checked against en.json.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
