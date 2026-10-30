"use client";

import { Link } from "@/lib/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { type CheckIn, isMessageKey, type MessageKey, normalizeCheckInCode } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { FLUSHED_EVENT, type FlushResult, isNetworkError, loadPass, queueCheckIn, queuedCheckIns } from "@/lib/offline";
import { useRequireRole } from "@/lib/use-require-role";
import { BoardButton, boardButtonClass, BoardField, BoardInput } from "@/components/board/field";
import { Masthead } from "@/components/board/masthead";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";

const SCANNER_ID = "checkin-scanner";

type Reading = { lat: number; lng: number; accuracy: number };

type Step =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "locating" }
  | { kind: "sending" }
  | { kind: "walk-in"; roleTitle: string; companyName: string }
  | { kind: "done"; checkIn: CheckIn; again: boolean }
  | { kind: "queued" }
  | { kind: "failed"; error: unknown; fallback: MessageKey };

// The QR on the employer's screen is a link to this page with the code after
// the "#", so a phone's own camera app works too; the scanner here accepts
// either the link or a bare code.
function codeFrom(scanned: string): string {
  const hash = scanned.indexOf("#");
  return hash === -1 ? scanned.trim() : scanned.slice(hash + 1).trim();
}

// Typing the code is a first-class way in, not a fallback behind a link: bad
// lighting and old phone cameras are the ordinary case at a venue.
function TypedCode({ onSubmit }: { onSubmit: (code: string) => void }) {
  const t = useTranslations("checkin");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="grid gap-3 border-t border-housing-line pt-5"
      onSubmit={(event) => {
        event.preventDefault();
        const code = normalizeCheckInCode(value);
        if (!code) {
          setError(t("codeShape"));
          return;
        }
        onSubmit(code);
      }}
    >
      <BoardField label={t("typeCode")} hint={t("typeCodeHint")}>
        <BoardInput
          board
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={11}
          aria-invalid={error ? true : undefined}
          className="h-14 text-[1.5rem] uppercase tracking-[0.15em]"
        />
      </BoardField>
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
      <div>
        <BoardButton type="submit" variant="quiet">
          {t("withCode")}
        </BoardButton>
      </div>
    </form>
  );
}

// Rejects with the catalog key for what went wrong, worded by the page.
function locate(): Promise<Reading> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }),
      (err) => reject(err.code === err.PERMISSION_DENIED ? "checkin.locationOff" : "checkin.noFix"),
      // maximumAge 0: a cached reading could be from home, an hour ago.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  });
}

export default function CheckInPage() {
  const t = useTranslations("checkin");
  const errorText = useErrorText();
  const { formatTime, formatFlags } = useFormat();
  const ready = useRequireRole("CANDIDATE");
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const scanner = useRef<Html5Qrcode | null>(null);
  const pending = useRef<{ code: string; reading: Reading } | null>(null);

  const stopScanner = useCallback(async () => {
    if (scanner.current?.isScanning) await scanner.current.stop();
  }, []);

  const send = useCallback(async (code: string, reading: Reading, walkIn = false) => {
    const queue = async () => {
      await queueCheckIn({ code, ...reading });
      setStep({ kind: "queued" });
    };
    if (!navigator.onLine) return queue();
    setStep({ kind: "sending" });
    try {
      const result = await apiClient.checkIn({ code, ...reading, walkIn });
      if (result.outcome === "needs_registration") {
        pending.current = { code, reading };
        setStep({ kind: "walk-in", roleTitle: result.drive.roleTitle, companyName: result.drive.companyName });
      } else {
        setStep({ kind: "done", checkIn: result.checkIn, again: result.outcome === "already_checked_in" });
      }
    } catch (err) {
      // No answer at all: the signal dropped between scanning and sending.
      if (isNetworkError(err)) return queue();
      setStep({ kind: "failed", error: err, fallback: "checkin.failed" });
    }
  }, []);

  const checkInWith = useCallback(
    async (code: string) => {
      setStep({ kind: "locating" });
      try {
        await send(code, await locate());
      } catch (err) {
        setStep({ kind: "failed", error: null, fallback: typeof err === "string" && isMessageKey(err) ? err : "checkin.noFix" });
      }
    },
    [send],
  );

  // Opened from the phone's camera app: the code arrived in the address, so
  // there is nothing to scan. It is dropped from the address straight away
  // so a refresh or a screenshot doesn't carry it around.
  useEffect(() => {
    if (!ready || !window.location.hash) return;
    const code = codeFrom(window.location.hash);
    history.replaceState(null, "", window.location.pathname);
    if (code) checkInWith(code);
  }, [ready, checkInWith]);

  useEffect(() => () => void stopScanner(), [stopScanner]);

  // Loaded now rather than on the first tap, so the service worker has the
  // scanner cached before anyone needs it with no signal.
  useEffect(() => {
    void import("html5-qrcode");
  }, []);

  const [online, setOnline] = useState(true);
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      setWaiting(queuedCheckIns().length);
    };
    // A queued scan sent from this page or any other: show how it went.
    const onFlushed = (event: Event) => {
      update();
      const last = (event as CustomEvent<FlushResult[]>).detail.at(-1);
      if (!last) return;
      setStep((current) =>
        current.kind !== "queued"
          ? current
          : last.status === "sent"
            ? { kind: "done", checkIn: last.checkIn, again: false }
            : { kind: "failed", error: last.error, fallback: "errors.checkIn.refused" },
      );
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener(FLUSHED_EVENT, onFlushed);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener(FLUSHED_EVENT, onFlushed);
    };
  }, [step.kind]);

  async function startScanning() {
    if (!window.isSecureContext) {
      setStep({ kind: "failed", error: null, fallback: "checkin.needsHttps" });
      return;
    }
    setStep({ kind: "scanning" });
    const { Html5Qrcode } = await import("html5-qrcode");
    scanner.current ??= new Html5Qrcode(SCANNER_ID, { verbose: false });
    try {
      await scanner.current.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        async (decoded) => {
          await stopScanner();
          checkInWith(codeFrom(decoded));
        },
        undefined,
      );
    } catch {
      setStep({ kind: "failed", error: null, fallback: "checkin.noCamera" });
    }
  }

  async function scanAgain() {
    await stopScanner();
    pending.current = null;
    setStep({ kind: "idle" });
  }

  if (!ready) return null;

  return (
    <div className="min-h-screen bg-housing text-stock">
      <Masthead />
      <main className="mx-auto grid max-w-md gap-6 px-4 py-8">
        <h1 className="type-h1">{t("heading")}</h1>

        {!online && <OfflinePass />}
        {waiting > 0 && step.kind !== "queued" && (
          <p className="type-meta text-housing-muted">{t("waiting", { count: waiting })}</p>
        )}

        <div role="status" className="grid gap-4">
          {step.kind === "idle" && (
            <>
              <p className="type-body text-housing-muted">{t("intro")}</p>
              <div>
                <BoardButton onClick={startScanning}>{t("scan")}</BoardButton>
              </div>
              <TypedCode onSubmit={checkInWith} />
            </>
          )}
          {step.kind === "scanning" && <p className="type-body text-housing-muted">{t("pointCamera")}</p>}
          {step.kind === "locating" && <p className="type-body">{t("locating")}</p>}
          {step.kind === "sending" && <p className="type-body">{t("sending")}</p>}

          {step.kind === "walk-in" && (
            <div className="grid gap-4 border border-housing-rule p-4">
              <p className="type-body">{t("walkInOffer", { role: step.roleTitle, company: step.companyName })}</p>
              <div className="flex flex-wrap gap-3">
                <BoardButton
                  onClick={() => pending.current && send(pending.current.code, pending.current.reading, true)}
                >
                  {t("registerWalkIn")}
                </BoardButton>
                <BoardButton variant="quiet" onClick={scanAgain}>
                  {t("notNow")}
                </BoardButton>
              </div>
            </div>
          )}

          {step.kind === "queued" && (
            <div className="grid gap-2 border border-housing-rule p-4">
              <p className="type-h3">{t("savedHeading")}</p>
              <p className="type-body text-housing-muted">{t("savedBody")}</p>
            </div>
          )}

          {step.kind === "done" && (
            <div className="grid gap-3 border border-housing-rule p-4">
              <p className="type-h2">{step.again ? t("alreadyIn") : t("in")}</p>
              <p className="type-board-md">{t("at", { time: formatTime(step.checkIn.scannedAt) })}</p>
              {!step.checkIn.isValid && (
                <p className="type-meta text-housing-muted">{t("flagged", { reason: formatFlags(step.checkIn).toLowerCase() })}</p>
              )}
              <Link href="/my-drives" className={boardButtonClass("housing", "quiet")}>
                {t("yourDrives")}
              </Link>
            </div>
          )}

          {step.kind === "failed" && (
            <div className="grid gap-4">
              <p role="alert" className="type-body text-closing-lamp">
                {errorText(step.error, step.fallback)}
              </p>
              <div>
                <BoardButton onClick={scanAgain}>{t("scanAgain")}</BoardButton>
              </div>
            </div>
          )}
        </div>

        {/* Always mounted: the scanner library needs this element to exist before it starts. */}
        <div
          id={SCANNER_ID}
          className={step.kind === "scanning" ? "aspect-square w-full overflow-hidden border border-housing-rule" : "hidden"}
        />
        {step.kind === "scanning" && (
          <div>
            <BoardButton variant="quiet" onClick={scanAgain}>
              {t("cancel")}
            </BoardButton>
          </div>
        )}
      </main>
    </div>
  );
}

// With no signal, the candidate's next booked drive from the copy saved on
// this phone, so they can still see where and when.
function OfflinePass() {
  const t = useTranslations("checkin");
  const moved = useTranslations("myDrives");
  const { dayLabel, formatTime } = useFormat();
  const [pass] = useState(() => loadPass());
  const [now] = useState(() => new Date());
  const next = pass?.applications.upcoming.find((a) => a.state === "CONFIRMED");
  return (
    <div className="grid gap-1 border-l-4 border-pending-lamp bg-housing-raised p-4">
      <p className="type-meta">{t("offline")}</p>
      {pass && <p className="type-body">{t("synced", { day: dayLabel(new Date(pass.savedAt), now), time: formatTime(pass.savedAt) })}</p>}
      {pass && next?.drive.rescheduledFrom && (
        <p role="alert" className="type-body text-closing-lamp">
          {moved("movedOffline", { day: dayLabel(new Date(pass.savedAt), now), time: formatTime(pass.savedAt) })}
        </p>
      )}
      {next && (
        <p className="type-board-md">
          {next.slotStartsAt
            ? t("nextWithSlot", { role: next.drive.roleTitle, company: next.drive.companyName, time: formatTime(next.slotStartsAt) })
            : t("next", { role: next.drive.roleTitle, company: next.drive.companyName })}
        </p>
      )}
    </div>
  );
}
