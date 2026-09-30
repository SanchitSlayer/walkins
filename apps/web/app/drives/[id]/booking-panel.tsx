"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatTime, formatWhen, type MyApplication, type PublicDriveDetail } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, boardButtonClass } from "@/components/board/field";
import { SlotStack } from "@/components/board/slot-stack";

const CHECK_IN_OPENS_MS = 60 * 60_000;

type Viewer = "loading" | "anonymous" | "other-role" | "no-profile" | "candidate";

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
  const [viewer, setViewer] = useState<Viewer>("loading");
  const [application, setApplication] = useState<MyApplication | null>(null);
  const [slotId, setSlotId] = useState<string | null>(null);
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
      setError(err instanceof Error ? err.message : "That didn't go through");
      await onSeatsChanged();
    } finally {
      setBusy(false);
    }
  }

  const state = application?.state;
  const canPick = bookable && viewer === "candidate" && (!state || state === "WITHDRAWN" || state === "INTERESTED");
  const checkInOpen = now.getTime() >= new Date(drive.startsAt).getTime() - CHECK_IN_OPENS_MS;
  const bookedAt = application?.slotStartsAt ? formatWhen(application.slotStartsAt, application.slotStartsAt, now) : null;

  return (
    <section aria-labelledby="slots-heading" className="grid gap-4">
      <h2 id="slots-heading" className="type-h3">
        Interview slots
      </h2>

      {state === "CONFIRMED" && application && (
        <div className="grid gap-3 border border-housing-rule p-4">
          <p className="type-body">
            You&apos;re booked for{" "}
            <span className="type-board-md whitespace-nowrap">
              {bookedAt ? `${bookedAt.day}, ${formatTime(application.slotStartsAt!)}` : "this drive"}
            </span>
            .
          </p>
          <div className="flex flex-wrap gap-3">
            {checkInOpen && (
              <Link href="/checkin" className={boardButtonClass()}>
                Check in
              </Link>
            )}
            <Link href="/my-drives" className={boardButtonClass("housing", "quiet")}>
              Your drives
            </Link>
            <BoardButton
              variant="quiet"
              disabled={busy}
              onClick={() => {
                if (confirm("Release your seat? Someone else can then book it.")) {
                  act(() => apiClient.releaseApplication(application.id));
                }
              }}
            >
              {busy ? "Releasing" : "Release my seat"}
            </BoardButton>
          </div>
        </div>
      )}

      {application?.checkIn && (
        <p className="type-body border border-housing-rule p-4">
          You checked in at{" "}
          <span className="type-board-md">{formatTime(application.checkIn.scannedAt)}</span>.
        </p>
      )}

      {state === "NO_SHOW" && (
        <p className="type-body border border-housing-rule p-4">You were marked as not attending this drive.</p>
      )}

      {canPick ? (
        <fieldset className="grid gap-4">
          <legend className="type-meta mb-3 text-housing-muted">
            {state === "WITHDRAWN" ? "You released your seat earlier. Pick a slot to book again." : "Pick a slot to book a seat."}
          </legend>
          <SlotStack slots={drive.slots} now={now} selectedId={slotId} onSelect={setSlotId} />
          <div>
            <BoardButton disabled={!slotId || busy} onClick={() => slotId && act(() => apiClient.apply(drive.id, slotId))}>
              {busy ? "Booking" : "Book this slot"}
            </BoardButton>
          </div>
        </fieldset>
      ) : (
        <SlotStack slots={drive.slots} now={now} />
      )}

      {bookable && viewer === "anonymous" && (
        <p className="type-meta text-housing-muted">
          <Link href={`/login?next=${encodeURIComponent(`/drives/${drive.id}`)}`} className="text-stock underline underline-offset-4">
            Log in to book a slot
          </Link>
          . You can also walk in during the drive without booking.
        </p>
      )}
      {bookable && viewer === "no-profile" && (
        <p className="type-meta text-housing-muted">
          <Link href="/profile" className="text-stock underline underline-offset-4">
            Save your profile
          </Link>{" "}
          to book a slot.
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
