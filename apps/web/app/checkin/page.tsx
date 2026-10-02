"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { type CheckIn, formatTime } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { FLUSHED_EVENT, type FlushResult, isNetworkError, loadPass, queueCheckIn, queuedCheckIns } from "@/lib/offline";
import { useRequireRole } from "@/lib/use-require-role";
import { BoardButton, boardButtonClass } from "@/components/board/field";
import { Masthead } from "@/components/board/masthead";

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
  | { kind: "failed"; message: string };

// The QR on the employer's screen is a link to this page with the code after
// the "#", so a phone's own camera app works too; the scanner here accepts
// either the link or a bare code.
function tokenFrom(scanned: string): string {
  const hash = scanned.indexOf("#");
  return hash === -1 ? scanned.trim() : scanned.slice(hash + 1).trim();
}

function locate(): Promise<Reading> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? "Location is off for this site. Allow it in your browser settings, or ask the employer at the desk to check you in."
              : "Couldn't get a location fix. Step nearer a window and scan again, or ask the employer at the desk.",
          ),
        ),
      // maximumAge 0: a cached reading could be from home, an hour ago.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  });
}

export default function CheckInPage() {
  const ready = useRequireRole("CANDIDATE");
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const scanner = useRef<Html5Qrcode | null>(null);
  const pending = useRef<{ token: string; reading: Reading } | null>(null);

  const stopScanner = useCallback(async () => {
    if (scanner.current?.isScanning) await scanner.current.stop();
  }, []);

  const send = useCallback(async (token: string, reading: Reading, walkIn = false) => {
    const queue = async () => {
      await queueCheckIn({ token, ...reading });
      setStep({ kind: "queued" });
    };
    if (!navigator.onLine) return queue();
    setStep({ kind: "sending" });
    try {
      const result = await apiClient.checkIn({ token, ...reading, walkIn });
      if (result.outcome === "needs_registration") {
        pending.current = { token, reading };
        setStep({ kind: "walk-in", roleTitle: result.drive.roleTitle, companyName: result.drive.companyName });
      } else {
        setStep({ kind: "done", checkIn: result.checkIn, again: result.outcome === "already_checked_in" });
      }
    } catch (err) {
      // No answer at all: the signal dropped between scanning and sending.
      if (isNetworkError(err)) return queue();
      setStep({ kind: "failed", message: err instanceof Error ? err.message : "Check-in didn't go through" });
    }
  }, []);

  const checkInWith = useCallback(
    async (token: string) => {
      setStep({ kind: "locating" });
      try {
        await send(token, await locate());
      } catch (err) {
        setStep({ kind: "failed", message: err instanceof Error ? err.message : "Couldn't get your location" });
      }
    },
    [send],
  );

  // Opened from the phone's camera app: the code arrived in the address, so
  // there is nothing to scan. It is dropped from the address straight away
  // so a refresh or a screenshot doesn't carry it around.
  useEffect(() => {
    if (!ready || !window.location.hash) return;
    const token = tokenFrom(window.location.hash);
    history.replaceState(null, "", window.location.pathname);
    if (token) checkInWith(token);
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
            : { kind: "failed", message: last.message },
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
      setStep({ kind: "failed", message: "The camera only works when this page is opened over https." });
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
          checkInWith(tokenFrom(decoded));
        },
        undefined,
      );
    } catch {
      setStep({
        kind: "failed",
        message: "Couldn't open the camera. Allow camera access for this site, or point your phone's camera app at the code instead.",
      });
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
        <h1 className="type-h1">Check in</h1>

        {!online && <OfflinePass />}
        {waiting > 0 && step.kind !== "queued" && (
          <p className="type-meta text-housing-muted">
            {waiting === 1 ? "1 check-in is" : `${waiting} check-ins are`} waiting to send.
          </p>
        )}

        <div role="status" className="grid gap-4">
          {step.kind === "idle" && (
            <>
              <p className="type-body text-housing-muted">
                Scan the code on the screen at the venue. Your location is checked once, to confirm you&apos;re there.
              </p>
              <div>
                <BoardButton onClick={startScanning}>Scan the code</BoardButton>
              </div>
            </>
          )}
          {step.kind === "scanning" && <p className="type-body text-housing-muted">Point your camera at the code.</p>}
          {step.kind === "locating" && <p className="type-body">Code read. Getting your location…</p>}
          {step.kind === "sending" && <p className="type-body">Checking you in…</p>}

          {step.kind === "walk-in" && (
            <div className="grid gap-4 border border-housing-rule p-4">
              <p className="type-body">
                You haven&apos;t booked a slot for {step.roleTitle} at {step.companyName}. You can still register as a walk-in and
                be checked in now.
              </p>
              <div className="flex flex-wrap gap-3">
                <BoardButton
                  onClick={() => pending.current && send(pending.current.token, pending.current.reading, true)}
                >
                  Register as a walk-in
                </BoardButton>
                <BoardButton variant="quiet" onClick={scanAgain}>
                  Not now
                </BoardButton>
              </div>
            </div>
          )}

          {step.kind === "queued" && (
            <div className="grid gap-2 border border-housing-rule p-4">
              <p className="type-h3">Saved on this phone</p>
              <p className="type-body text-housing-muted">
                There&apos;s no signal, so your check-in will be sent as soon as there is. It needs to go within 30 minutes; keep
                this page open if you can, or open Walkins again once you have signal.
              </p>
            </div>
          )}

          {step.kind === "done" && (
            <div className="grid gap-3 border border-housing-rule p-4">
              <p className="type-h2">{step.again ? "You're already checked in" : "You're checked in"}</p>
              <p className="type-board-md">At {formatTime(step.checkIn.scannedAt)}</p>
              {!step.checkIn.isValid && (
                <p className="type-meta text-housing-muted">
                  The employer will confirm this one at the desk: {step.checkIn.flagReason?.toLowerCase()}.
                </p>
              )}
              <Link href="/my-drives" className={boardButtonClass("housing", "quiet")}>
                Your drives
              </Link>
            </div>
          )}

          {step.kind === "failed" && (
            <div className="grid gap-4">
              <p role="alert" className="type-body text-closing-lamp">
                {step.message}
              </p>
              <div>
                <BoardButton onClick={scanAgain}>Scan again</BoardButton>
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
              Cancel
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
  const [pass] = useState(() => loadPass());
  const next = pass?.applications.upcoming.find((a) => a.state === "CONFIRMED");
  return (
    <div className="grid gap-1 border-l-4 border-pending-lamp bg-housing-raised p-4">
      <p className="type-meta">You&apos;re offline. Scanning still works; your check-in is sent when the signal is back.</p>
      {next && (
        <p className="type-board-md">
          {next.drive.roleTitle} at {next.drive.companyName}
          {next.slotStartsAt ? ` · slot ${formatTime(next.slotStartsAt)}` : ""}
        </p>
      )}
    </div>
  );
}
