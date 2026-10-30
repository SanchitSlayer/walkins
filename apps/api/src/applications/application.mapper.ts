import type { Application, CheckIn as CheckInRow, Company, Drive, DriveReschedule, DriveSlot, HiringOutcome, Role } from "@walkins/db";
import { type CheckIn, dayKey, type MyApplication } from "@walkins/shared";
import { editableUntil } from "./outcomes.service";

export const MY_APPLICATION_INCLUDE = {
  drive: { include: { role: true, company: true, reschedules: { orderBy: { version: "desc" }, take: 1 } } },
  slot: true,
  checkIn: true,
  outcome: true,
} as const;

type MyApplicationRow = Application & {
  drive: Drive & { role: Role; company: Company; reschedules: DriveReschedule[] };
  slot: DriveSlot | null;
  checkIn: CheckInRow | null;
  outcome: HiringOutcome | null;
};

export function toCheckIn(row: CheckInRow): CheckIn {
  return {
    id: row.id,
    applicationId: row.applicationId,
    method: row.method,
    scannedAt: row.scannedAt.toISOString(),
    capturedAt: row.capturedAt?.toISOString() ?? null,
    distanceMeters: row.distanceMeters,
    accuracyMeters: row.accuracyMeters,
    isValid: row.isValid,
    flags: row.flags,
    lateBySeconds: row.lateBySeconds,
  };
}

export function toMyApplication(row: MyApplicationRow): MyApplication {
  return {
    id: row.id,
    state: row.state,
    screenedOutReason: row.screenedOutReason,
    slotStartsAt: row.slot?.startsAt.toISOString() ?? null,
    drive: {
      id: row.drive.id,
      roleTitle: row.drive.role.title,
      companyName: row.drive.company.name,
      venueAddress: row.drive.venueAddress,
      venueLat: row.drive.venueLat,
      venueLng: row.drive.venueLng,
      startsAt: row.drive.startsAt.toISOString(),
      endsAt: row.drive.endsAt.toISOString(),
      status: row.drive.status,
      rescheduledFrom: row.drive.reschedules[0]
        ? { startsAt: row.drive.reschedules[0].fromStartsAt.toISOString(), endsAt: row.drive.reschedules[0].fromEndsAt.toISOString() }
        : null,
    },
    checkIn: row.checkIn ? toCheckIn(row.checkIn) : null,
    outcome: row.outcome && row.state === "HIRED" ? toMyOutcome(row.outcome) : null,
  };
}

// The candidate is asked "did you start?" once the joining date has come
// (or straight away if none was agreed), until the correction window ends.
function toMyOutcome(o: HiringOutcome) {
  const joiningDate = o.joiningDate?.toISOString().slice(0, 10) ?? null;
  const today = dayKey(new Date());
  return {
    joiningDate,
    candidateStarted: o.candidateStarted,
    canAnswer: (joiningDate === null || joiningDate <= today) && editableUntil(o) >= today,
  };
}
