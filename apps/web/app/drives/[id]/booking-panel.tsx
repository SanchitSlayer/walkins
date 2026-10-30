"use client";

import { Link } from "@/lib/navigation";
import { type ReactNode, useEffect, useState } from "react";
import {
  type KnockoutAnswers,
  type MyApplication,
  type PublicDriveDetail,
  type PublicKnockoutQuestion,
} from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, boardButtonClass, BoardInput } from "@/components/board/field";
import { SlotStack } from "@/components/board/slot-stack";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";

const CHECK_IN_OPENS_MS = 60 * 60_000;

type Viewer = "loading" | "anonymous" | "other-role" | "no-profile" | "candidate";

function KnockoutField({
  question,
  value,
  onChange,
}: {
  question: PublicKnockoutQuestion;
  value: KnockoutAnswers[string] | undefined;
  onChange: (value: KnockoutAnswers[string] | undefined) => void;
}) {
  const t = useTranslations("booking");
  if (question.type === "NUMERIC") {
    return (
      <label className="grid gap-1.5">
        <span className="type-body">{question.prompt}</span>
        <span className="flex items-center gap-2">
          <BoardInput
            type="number"
            inputMode="decimal"
            board
            className="w-32"
            value={typeof value === "number" ? value : ""}
            onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          />
          {question.unit && <span className="type-meta text-housing-muted">{question.unit}</span>}
        </span>
      </label>
    );
  }
  const choices: { label: string; value: boolean | string }[] =
    question.type === "BOOLEAN"
      ? [
          { label: t("yes"), value: true },
          { label: t("no"), value: false },
        ]
      : (question.options ?? []).map((o) => ({ label: o, value: o }));
  return (
    <fieldset className="grid gap-1.5">
      <legend className="type-body mb-1.5">{question.prompt}</legend>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          <label
            key={choice.label}
            className="type-meta flex min-h-11 cursor-pointer items-center gap-2 border border-housing-rule px-4 has-[:checked]:border-stock has-[:checked]:bg-housing-raised"
          >
            <input
              type="radio"
              name={`knockout-${question.id}`}
              checked={value === choice.value}
              onChange={() => onChange(choice.value)}
              className="accent-[currentColor]"
            />
            {choice.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// The drive page's slot section: the plain seat board for anyone who can't
// book, the same board as a picker for a candidate who can, and their
// booking once they have one.
export function BookingPanel({
  drive,
  now,
  bookable,
  onSeatsChanged,
}: {
  drive: PublicDriveDetail;
  now: Date;
  bookable: boolean;
  onSeatsChanged: () => Promise<void>;
}) {
  const t = useTranslations("booking");
  const errorText = useErrorText();
  const { formatTime, formatWhen } = useFormat();
  const [viewer, setViewer] = useState<Viewer>("loading");
  const [application, setApplication] = useState<MyApplication | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<KnockoutAnswers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.restoreSession().then(async (session) => {
      if (!session) return setViewer("anonymous");
      if (session.role !== "CANDIDATE") return setViewer("other-role");
      if (!(await apiClient.getMyProfile())) return setViewer("no-profile");
      const mine = await apiClient.listMyApplications();
      setApplication([...mine.upcoming, ...mine.past].find((a) => a.drive.id === drive.id) ?? null);
      setViewer("candidate");
    });
  }, [drive.id]);

  async function act(action: () => Promise<MyApplication>) {
    setBusy(true);
    setError(null);
    try {
      setApplication(await action());
      setSlotId(null);
      await onSeatsChanged();
    } catch (err) {
      setError(errorText(err, "errors.generic"));
      await onSeatsChanged();
    } finally {
      setBusy(false);
    }
  }

  const findOthers = (chunks: ReactNode) => (
    <Link href="/" className="text-stock underline underline-offset-4">
      {chunks}
    </Link>
  );
  const state = application?.state;
  const canPick = bookable && viewer === "candidate" && (!state || state === "WITHDRAWN" || state === "INTERESTED");
  const checkInOpen = now.getTime() >= new Date(drive.startsAt).getTime() - CHECK_IN_OPENS_MS;
  const bookedAt = application?.slotStartsAt ? formatWhen(application.slotStartsAt, application.slotStartsAt, now) : null;
  const answeredAll = drive.knockoutQuestions.every((q) => answers[q.id] !== undefined);

  return (
    <section aria-labelledby="slots-heading" className="grid gap-4">
      <h2 id="slots-heading" className="type-h3">
        {t("heading")}
      </h2>

      {state === "CONFIRMED" && application && (
        <div className="grid gap-3 border border-housing-rule p-4">
          <p className="type-body">
            {t.rich("booked", {
              when: bookedAt ? t("bookedWhen", { day: bookedAt.day, time: formatTime(application.slotStartsAt!) }) : t("thisDrive"),
              strong: (chunks) => <span className="type-board-md whitespace-nowrap">{chunks}</span>,
            })}
          </p>
          <div className="flex flex-wrap gap-3">
            {checkInOpen && (
              <Link href="/checkin" className={boardButtonClass()}>
                {t("checkIn")}
              </Link>
            )}
            <Link href="/my-drives" className={boardButtonClass("housing", "quiet")}>
              {t("yourDrives")}
            </Link>
            <BoardButton
              variant="quiet"
              disabled={busy}
              onClick={() => {
                if (confirm(t("releaseConfirm"))) {
                  act(() => apiClient.releaseApplication(application.id));
                }
              }}
            >
              {busy ? t("releasing") : t("release")}
            </BoardButton>
          </div>
        </div>
      )}

      {application?.checkIn && (
        <p className="type-body border border-housing-rule p-4">
          {t.rich("checkedIn", {
            time: formatTime(application.checkIn.scannedAt),
            strong: (chunks) => <span className="type-board-md">{chunks}</span>,
          })}
        </p>
      )}

      {state === "SCREENED_OUT" && (
        <div className="grid gap-2 border border-housing-rule p-4">
          <p className="type-body">{t("screenedOut")}</p>
          {application?.screenedOutReason && (
            <p className="type-body">
              {t.rich("asksFor", {
                requirement: application.screenedOutReason,
                strong: (chunks) => <span className="text-stock">{chunks}</span>,
              })}
            </p>
          )}
          <p className="type-meta text-housing-muted">{t.rich("noNeedToTravel", { link: findOthers })}</p>
        </div>
      )}

      {state === "REJECTED" && !application?.checkIn && (
        <div className="grid gap-2 border border-housing-rule p-4">
          <p className="type-body">{t("rejected")}</p>
          <p className="type-meta text-housing-muted">{t.rich("noNeedToTravel", { link: findOthers })}</p>
        </div>
      )}

      {state === "NO_SHOW" && (
        <p className="type-body border border-housing-rule p-4">{t("noShow")}</p>
      )}

      {canPick ? (
        <fieldset className="grid gap-4">
          <legend className="type-meta mb-3 text-housing-muted">
            {state === "WITHDRAWN" ? t("pickAgain") : t("pick")}
          </legend>
          <SlotStack slots={drive.slots} now={now} selectedId={slotId} onSelect={setSlotId} />
          {drive.knockoutQuestions.length > 0 && (
            <div className="grid gap-4 border border-housing-rule p-4">
              <p className="type-meta text-housing-muted">{t("questionsIntro")}</p>
              {drive.knockoutQuestions.map((question) => (
                <KnockoutField
                  key={question.id}
                  question={question}
                  value={answers[question.id]}
                  onChange={(value) =>
                    setAnswers((prev) => {
                      const next = { ...prev };
                      if (value === undefined) delete next[question.id];
                      else next[question.id] = value;
                      return next;
                    })
                  }
                />
              ))}
            </div>
          )}
          <div>
            <BoardButton
              disabled={!slotId || !answeredAll || busy}
              onClick={() => slotId && act(() => apiClient.apply(drive.id, slotId, answers))}
            >
              {busy ? t("booking") : t("book")}
            </BoardButton>
          </div>
        </fieldset>
      ) : (
        <SlotStack slots={drive.slots} now={now} />
      )}

      {bookable && viewer === "anonymous" && (
        <p className="type-meta text-housing-muted">
          {t.rich("logInToBook", {
            link: (chunks) => (
              <Link href={`/login?next=${encodeURIComponent(`/drives/${drive.id}`)}`} className="text-stock underline underline-offset-4">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
      {bookable && viewer === "no-profile" && (
        <p className="type-meta text-housing-muted">
          {t.rich("profileToBook", {
            link: (chunks) => (
              <Link href="/profile" className="text-stock underline underline-offset-4">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}

      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
    </section>
  );
}
