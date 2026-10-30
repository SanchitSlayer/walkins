"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { isLocalizedPath, type Locale, OFFERED_LOCALES, splitLocalePath } from "@walkins/shared";
import { Link, readIn, usePageLocale, useRouter } from "@/lib/navigation";
import { apiClient } from "@/lib/api-client";
import { forgetDevice } from "@/lib/offline";
import { useTranslations } from "next-intl";

const NAV_BY_ROLE: Record<string, { href: string; label: "yourDrives" | "yourProfile" | "admin" }[]> = {
  CANDIDATE: [
    { href: "/my-drives", label: "yourDrives" },
    { href: "/profile", label: "yourProfile" },
  ],
  EMPLOYER: [{ href: "/employer/drives", label: "yourDrives" }],
  ADMIN: [{ href: "/admin", label: "admin" }],
};

export function LogoutButton({ onLoggedOut }: { onLoggedOut?: () => void }) {
  const t = useTranslations("nav");
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logOut() {
    setPending(true);
    try {
      await apiClient.logout();
      forgetDevice();
      onLoggedOut?.();
      router.push("/");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={logOut}
      disabled={pending}
      className="type-meta min-h-11 whitespace-nowrap text-housing-muted underline-offset-4 hover:text-stock hover:underline disabled:opacity-60"
    >
      {pending ? t("loggingOut") : t("logOut")}
    </button>
  );
}

function SessionNav() {
  const t = useTranslations("nav");
  const [role, setRole] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    apiClient.restoreSession().then((session) => setRole(session?.role ?? null));
  }, []);

  // Width is reserved while the session resolves so the masthead doesn't shift.
  if (role === undefined) {
    return <span className="inline-block w-24" aria-hidden />;
  }
  if (!role) {
    return (
      <Link href="/login" className="type-meta text-stock underline-offset-4 hover:underline">
        {t("logIn")}
      </Link>
    );
  }
  return (
    <nav aria-label={t("account")} className="flex items-center gap-5">
      {(NAV_BY_ROLE[role] ?? []).map((link) => (
        <Link key={link.href} href={link.href} className="type-meta whitespace-nowrap text-stock underline-offset-4 hover:underline">
          {t(link.label)}
        </Link>
      ))}
      <LogoutButton onLoggedOut={() => setRole(null)} />
    </nav>
  );
}

// The other language's own name, on pages that exist in both. Absent until
// a second language is offered.
function LanguageSwitch() {
  const t = useTranslations("language");
  const page = usePageLocale();
  const pathname = usePathname();
  const [failed, setFailed] = useState(false);
  if (OFFERED_LOCALES.length === 1 || !isLocalizedPath(splitLocalePath(pathname).path)) return null;

  function switchTo(locale: Locale) {
    setFailed(false);
    readIn(locale).catch(() => setFailed(true));
  }

  return (
    <>
      {OFFERED_LOCALES.filter((locale) => locale !== page).map((locale) => (
        <button
          key={locale}
          type="button"
          lang={locale}
          onClick={() => switchTo(locale)}
          aria-label={t("switchTo", { language: t(`name.${locale}`) })}
          className="type-meta min-h-11 whitespace-nowrap text-stock underline-offset-4 hover:underline"
        >
          {t(`name.${locale}`)}
        </button>
      ))}
      {failed && (
        <span role="alert" className="type-meta text-closing-lamp">
          {t("saveFailed")}
        </span>
      )}
    </>
  );
}

export function Masthead({ context }: { context?: string }) {
  return (
    <header className="border-b border-housing-line bg-housing-raised text-stock">
      {/* On a narrow phone the account links drop to their own row rather
          than squeezing the city name to a letter. */}
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-baseline gap-3">
          <Link href="/" className="type-h3 shrink-0">
            Walkins
          </Link>
          {context && <span className="type-board-md truncate text-housing-muted">{context}</span>}
        </div>
        <div className="flex items-center gap-5">
          <LanguageSwitch />
          <SessionNav />
        </div>
      </div>
    </header>
  );
}
