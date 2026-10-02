"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { dayLabel, type DriveDetail, formatTime } from "@walkins/shared";
import { ApiError, apiClient } from "@/lib/api-client";
import { BoardButton } from "@/components/board/field";
import { VenueOutsideCityNotice } from "../../venue-notice";

const RETRY_MS = 5_000;

type Code = { image: string; expiresAt: number; nextAt: number };

function pinnedLabel(iso: string) {
  return `${dayLabel(new Date(iso), new Date())}, ${formatTime(iso)}`;
}

// Where the check-in zone is measured from. Until the employer sets it from
// a device at the venue it is a geocode of the address, often an area centre
// hundreds of metres from the building, which fails every honest check-in.
function VenueLocation({ drive, onPinned }: { drive: DriveDetail; onPinned: (drive: DriveDetail) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  function pin() {
    if (!confirm("Set the venue to where this device is right now? Only do this at the venue: every check-in is measured from this point.")) {
      return;
    }
    setBusy(true);
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const reading = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy };
        try {
          let pinned: DriveDetail;
          try {
            pinned = await apiClient.pinVenue(drive.id, reading);
          } catch (err) {
            // Far outside the drive's city: the server names the distance and
            // only pins once the employer has seen it and said yes.
            if (!(err instanceof ApiError && err.body?.code === "PIN_FAR_FROM_CITY")) throw err;
            if (!confirm(`${err.message} Pin the venue here anyway?`)) {
              setMessage({ text: "Not pinned.", error: false });
              return;
            }
            pinned = await apiClient.pinVenue(drive.id, { ...reading, confirmFar: true });
          }
          onPinned(pinned);
          setMessage({ text: `Set, accurate to ±${Math.round(coords.accuracy)} m.`, error: false });
        } catch (err) {
          setMessage({ text: err instanceof Error ? err.message : "Couldn't set the venue location", error: true });
        } finally {
          setBusy(false);
        }
      },
      (err) => {
        setMessage({
          text:
            err.code === err.PERMISSION_DENIED
              ? "This browser isn't allowed to read the location. Allow it for this site and try again."
              : "Couldn't get a location fix. Turn Wi-Fi on or move nearer a window and try again.",
          error: true,
        });
        setBusy(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  }

  const unpinned = !drive.venuePinnedAt;
  return (
    <section
      aria-labelledby="venue-heading"
      className={
        unpinned
          ? `grid gap-3 border-l-4 bg-housing-raised p-4 ${drive.needsManualGeocode ? "border-closing-lamp" : "border-filling-lamp"}`
          : "grid gap-2"
      }
    >
      <h2 id="venue-heading" className={unpinned ? "type-h3" : "type-meta text-housing-muted"}>
        {unpinned ? "Venue location not set from the venue" : "Venue location"}
      </h2>
      {unpinned ? (
        <p className="type-body">
          {drive.needsManualGeocode
            ? "The address couldn't be found on the map, so the check-in zone is centred on the middle of the city. "
            : `The check-in zone is 200 m around a point guessed from the address “${drive.venueAddress}”, which can be hundreds of metres from the building. `}
          Until it is set from here, check-ins from inside the venue may be refused. Set it from this device while you&apos;re at the
          venue.
        </p>
      ) : (
        <p className="type-meta">Set from a device ({pinnedLabel(drive.venuePinnedAt!)}). Check-ins are measured from that point.</p>
      )}
      <div>
        <BoardButton variant={unpinned ? "primary" : "quiet"} onClick={pin} disabled={busy}>
          {busy ? "Reading this device's location" : unpinned ? "Set venue location from this device" : "Set it again from this device"}
        </BoardButton>
      </div>
      {message && (
        <p role={message.error ? "alert" : "status"} className={message.error ? "type-meta text-closing-lamp" : "type-meta text-live-lamp"}>
          {message.text}
        </p>
      )}
    </section>
  );
}

// The screen shown at the venue. The code is a link to /checkin carrying a
// token that lives 90 seconds and is replaced every 60, so a photo of it is
// useless within a couple of minutes.
export default function CheckInScreenPage() {
  const { id } = useParams<{ id: string }>();
  const [drive, setDrive] = useState<DriveDetail | null>(null);
  const [code, setCode] = useState<Code | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [host, setHost] = useState("");

  useEffect(() => {
    setHost(window.location.host);
    apiClient.getDrive(id).then(setDrive);
  }, [id]);

  const refresh = useCallback(async () => {
    try {
      const token = await apiClient.getCheckInToken(id);
      const image = await QRCode.toDataURL(`${window.location.origin}/checkin#${token.token}`, {
        width: 720,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#15140f", light: "#eae9e3" },
      });
      setCode({ image, expiresAt: new Date(token.expiresAt).getTime(), nextAt: Date.now() + token.rotateAfterSeconds * 1000 });
      setProblem(null);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn't get a check-in code");
      setCode((current) => current && { ...current, nextAt: Date.now() + RETRY_MS });
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // One clock drives both the countdown and the rotation, so they can't disagree.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (code && now >= code.nextAt) refresh();
  }, [code, now, refresh]);

  // A failed first fetch never set a code, so it has no nextAt to retry on.
  useEffect(() => {
    if (code || !problem) return;
    const retry = setTimeout(refresh, RETRY_MS);
    return () => clearTimeout(retry);
  }, [code, problem, refresh]);

  const live = code && now < code.expiresAt;
  const secondsToNext = code ? Math.max(0, Math.ceil((code.nextAt - now) / 1000)) : 0;

  return (
    <div className="grid gap-6">
      <div>
        <Link href={`/employer/drives/${id}`} className="type-meta text-housing-muted underline-offset-4 hover:underline">
          {drive ? drive.role.title : "Drive"}
        </Link>
        <h1 className="type-h2 mt-1">Check-in</h1>
        {drive && <p className="type-meta mt-1 text-housing-muted">{drive.venueAddress}</p>}
      </div>

      {drive && <VenueOutsideCityNotice drive={drive} />}
      {drive && !drive.venuePinnedAt && <VenueLocation drive={drive} onPinned={setDrive} />}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,34rem)_1fr]">
        <div className="grid gap-3">
          {live ? (
            <img
              src={code.image}
              alt="Check-in code for this drive. It changes every minute."
              className="aspect-square w-full max-w-[34rem] border border-housing-line"
            />
          ) : (
            <div className="grid aspect-square w-full max-w-[34rem] place-items-center border border-housing-line p-6 text-center">
              <p className="type-body text-housing-muted">{problem ?? "Getting a check-in code…"}</p>
            </div>
          )}
          <p className="type-board-sm text-housing-muted" aria-live="off">
            {live ? `New code in ${secondsToNext} s` : ""}
          </p>
          {live && problem && (
            <p role="alert" className="type-meta text-closing-lamp">
              Couldn&apos;t get a new code ({problem}). Still showing the last one; retrying.
            </p>
          )}
        </div>

        <div className="grid content-start gap-6">
          <section className="grid gap-2">
            <h2 className="type-h3">Candidates: scan to check in</h2>
            <p className="type-body text-housing-muted">
              Point your phone&apos;s camera at the code and open the link, or open{" "}
              <span className="type-board-md text-stock">{host}/checkin</span>{" "}
              and scan it there. Your location is checked once, to confirm you&apos;re here.
            </p>
          </section>
          {drive?.venuePinnedAt && <VenueLocation drive={drive} onPinned={setDrive} />}
        </div>
      </div>
    </div>
  );
}
