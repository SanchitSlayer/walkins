"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { MyInvitation, MyInvitations } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, boardButtonClass } from "@/components/board/field";
import { Masthead } from "@/components/board/masthead";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";

// Joining a company with one tap, after seeing which company it is. Indian
// carriers reissue numbers, so an invitation can reach someone who never
// worked there; the company's name and city, and who sent it, are the only
// guard, so they lead the page.
export default function JoinPage() {
  const t = useTranslations("join");
  const role = useTranslations("people.role");
  const can = useTranslations("people.invite.can");
  const errorText = useErrorText();
  const router = useRouter();
  const { dayLabel, formatDate, formatTime } = useFormat();
  const [mine, setMine] = useState<MyInvitations | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => new Date());

  useEffect(() => {
    (async () => {
      if (!apiClient.isAuthenticated() && !(await apiClient.restoreSession())) {
        router.replace("/login?next=%2Fjoin");
        return;
      }
      setMine(await apiClient.myInvitations());
    })().catch((err) => setError(errorText(err, "join.loadFailed")));
  }, [router]);

  async function join(invitation: MyInvitation) {
    setJoining(invitation.id);
    setError(null);
    try {
      await apiClient.acceptInvitation(invitation.id);
      // The account is an employer's now; a fresh session carries that.
      await apiClient.restoreSession();
      router.replace("/employer/drives");
    } catch (err) {
      setError(errorText(err, "join.failed"));
      setJoining(null);
    }
  }

  const blocked = (mine?.bookings.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-housing text-stock">
      <Masthead />
      <main className="mx-auto grid max-w-xl gap-6 px-4 py-8">
        <h1 className="type-h1">{t("heading")}</h1>

        {error && (
          <p role="alert" className="type-body text-closing-lamp">
            {error}
          </p>
        )}
        {!mine ? (
          !error && <p className="type-meta text-housing-muted">{t("loading")}</p>
        ) : mine.invitations.length === 0 ? (
          <div className="grid gap-3">
            <p className="type-body text-housing-muted">{t("none")}</p>
            <Link href="/profile" className="type-meta underline underline-offset-4">
              {t("toProfile")}
            </Link>
          </div>
        ) : (
          <>
            {blocked && (
              <div role="alert" className="grid gap-2 border-l-4 border-closing-lamp bg-housing-raised p-4">
                <p className="type-body">{t("bookedFirst", { count: mine.bookings.length })}</p>
                <ul className="grid gap-1">
                  {mine.bookings.map((b) => (
                    <li key={`${b.companyName}-${b.startsAt}`} className="type-board-sm">
                      {t("booking", { role: b.roleTitle, company: b.companyName, day: dayLabel(new Date(b.startsAt), now), time: formatTime(b.startsAt) })}
                    </li>
                  ))}
                </ul>
                <Link href="/my-drives" className="type-meta underline underline-offset-4">
                  {t("toMyDrives")}
                </Link>
              </div>
            )}

            <ul className="grid gap-4">
              {mine.invitations.map((i) => (
                <li key={i.id} className="grid gap-3 border border-housing-rule p-4">
                  <div>
                    <p className="type-h2">{i.companyName}</p>
                    <p className="type-meta text-housing-muted">{i.cityName}</p>
                  </div>
                  <p className="type-body">{t("invitedAs", { name: i.invitedBy, role: role(i.role) })}</p>
                  <p className="type-meta text-housing-muted">{can(i.role)}</p>
                  <p className="type-meta text-housing-muted">{t("expires", { day: formatDate(new Date(i.expiresAt)) })}</p>
                  <div>
                    <BoardButton onClick={() => join(i)} disabled={blocked || joining !== null}>
                      {joining === i.id ? t("joining") : t("join", { company: i.companyName })}
                    </BoardButton>
                  </div>
                </li>
              ))}
            </ul>

            <p className="type-meta text-housing-muted">{t("notYou")}</p>
            <div>
              <Link href="/profile" className={boardButtonClass("housing", "quiet")}>
                {t("notNow")}
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
