"use client";

import NextLink from "next/link";
import { useRouter as useNextRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { type ComponentProps, useMemo } from "react";
import { DEFAULT_LOCALE, isLocale, type Locale, localePath, splitLocalePath } from "@walkins/shared";
import { apiClient } from "./api-client";

// Links and navigation that keep a reader in the language they are reading:
// on a Hindi page, "/my-drives" means "/hi/my-drives". Pages that exist only
// in English (the employer console, admin) are left as they are.

export function usePageLocale(): Locale {
  const locale = useLocale();
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

export function Link({ href, ...props }: Omit<ComponentProps<typeof NextLink>, "href"> & { href: string }) {
  return <NextLink href={localePath(href, usePageLocale())} {...props} />;
}

export function useRouter() {
  const router = useNextRouter();
  const locale = usePageLocale();
  return useMemo(
    () => ({
      ...router,
      push: (href: string, options?: Parameters<typeof router.push>[1]) => router.push(localePath(href, locale), options),
      replace: (href: string, options?: Parameters<typeof router.replace>[1]) => router.replace(localePath(href, locale), options),
    }),
    [router, locale],
  );
}

// Switches the reader to another language: saved first for anyone signed in,
// whatever their role, so the choice outlives this page, then the same page
// reloaded at its address in that language. A full load rather than a client
// navigation, because both addresses share the root layout, and the router
// would keep the old language's <html lang> and catalog.
export async function readIn(locale: Locale) {
  if (apiClient.isAuthenticated()) await apiClient.setLocale(locale);
  const { pathname, search, hash } = window.location;
  window.location.assign(`${localePath(splitLocalePath(pathname).path, locale)}${search}${hash}`);
}
