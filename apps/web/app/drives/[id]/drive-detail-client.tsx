"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { type ReactNode, useEffect, useState } from "react";
import { formatDistance, formatExperience, formatSalary, formatSeats, formatWhen, type PublicDriveDetail } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { deriveBoardState, StatusMark } from "@/components/board/board-state";
import { Countdown } from "@/components/board/flap-display";
import { Slab } from "@/components/board/slab";
import { BookingPanel } from "./booking-panel";

const CityPlane = dynamic(() => import("@/components/board/city-plane"), {
  ssr: false,
  loading: () => <div className="h-80 border border-housing-line bg-housing-raised" />,
});

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-baseline gap-3 border-t border-stock-edge py-2 first:border-t-0">
      <dt className="type-meta text-ink-muted">{label}</dt>
      <dd className="type-board-md">{children}</dd>
    </div>
  );
}

export default function DriveDetailClient({ initial, renderedAt }: { initial: PublicDriveDetail; renderedAt: number }) {
  const [drive, setDrive] = useState(initial);
  const [fromHome, setFromHome] = useState(false);
  const [now, setNow] = useState(() => new Date(renderedAt));

  useEffect(() => {
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(tick);
  }, []);

  // The server render has no session, so it measures from the city centre;
  // a candidate gets the distance from their own home once hydrated.
  useEffect(() => {
    apiClient.restoreSession().then(async (session) => {
      if (session?.role !== "CANDIDATE" || !(await apiClient.getMyProfile())) return;
      setDrive(await apiClient.getPublicDrive(initial.id));
      setFromHome(true);
    });
  }, [initial.id]);

  const state = deriveBoardState(drive, now);
  const ended = state === "expired";
  const when = formatWhen(drive.startsAt, drive.endsAt, now);
  const cityPath = `/jobs/${drive.city.name.toLowerCase()}`;

  return (
    // On a phone both columns dissolve into one stack so the countdown can move
    // up to sit first, above the pass, instead of below every slot.
    <div className="grid gap-8 lg:grid-cols-[minmax(0,30rem)_1fr] lg:gap-10">
      <div className="contents lg:grid lg:content-start lg:gap-8">
        {ended && (
          <section className="border border-housing-rule p-5" aria-labelledby="ended-heading">
            <StatusMark state="expired" surface="housing" />
            <h2 id="ended-heading" className="type-h2 mt-2">
              This drive has ended
            </h2>
            <p className="type-body mt-2 text-housing-muted">
              It ran {when.day === "Today" ? "today" : `on ${when.day}`}, {when.time}. The details below are kept so a
              forwarded link still makes sense, but there is nothing left to attend.
            </p>
            <Link href={cityPath} className="type-meta mt-4 inline-block text-stock underline underline-offset-4">
              See live drives in {drive.city.name}
            </Link>
          </section>
        )}

        <Slab state={state} depth="lg" className="w-full">
          <h1 className="type-h2">{drive.role.title}</h1>
          <p className="type-meta mt-1 text-ink-muted">{drive.venueAddress}</p>
          <dl className="mt-5">
            <Row label="When">
              <span className="whitespace-nowrap">{when.day}</span>
              {" · "}
              <span className="whitespace-nowrap">{when.time}</span>
            </Row>
            <Row label="Pay">
              <span className="whitespace-nowrap">{formatSalary(drive.salaryMin, drive.salaryMax)}</span>
            </Row>
            <Row label="Experience">{formatExperience(drive.experienceMin, drive.experienceMax)}</Row>
            {!ended && <Row label="Seats">{formatSeats(drive.capacity, drive.bookedCount)}</Row>}
            <Row label="Distance">
              <span className="whitespace-nowrap">{formatDistance(drive.distanceKm)}</span>{" "}
              <span className="type-meta text-ink-muted">from {fromHome ? "your home" : "the city centre"}</span>
            </Row>
          </dl>
          <div className="mt-4">
            <StatusMark state={state} surface="stock" />
          </div>
        </Slab>

        {!ended && drive.slots.length > 0 && (
          <BookingPanel
            drive={drive}
            now={now}
            bookable={drive.status === "LIVE"}
            onSeatsChanged={async () => setDrive(await apiClient.getPublicDrive(drive.id))}
          />
        )}
      </div>

      <div className="contents lg:grid lg:content-start lg:gap-6">
        {!ended && <Countdown startsAt={drive.startsAt} endsAt={drive.endsAt} className="order-first lg:order-none" />}
        <section aria-label="Venue map">
          <CityPlane drives={[drive]} now={now} selectedId={null} className="h-80 lg:h-[28rem]" />
          <p className="type-meta mt-3 text-housing-muted">
            {drive.needsManualGeocode
              ? "This venue's address couldn't be placed exactly, so the pillar stands at the city centre. Go by the address."
              : ended
                ? "The pillar stands at the venue."
                : "The pillar stands at the venue. Its lit top is seats still open."}
          </p>
        </section>
      </div>
    </div>
  );
}
