import type { Application, CheckIn as CheckInRow, Company, Drive, DriveSlot, Role } from "@walkins/db";
import type { CheckIn, MyApplication } from "@walkins/shared";

export const MY_APPLICATION_INCLUDE = {
  drive: { include: { role: true, company: true } },
  slot: true,
  checkIn: true,
} as const;

type MyApplicationRow = Application & {
  drive: Drive & { role: Role; company: Company };
  slot: DriveSlot | null;
  checkIn: CheckInRow | null;
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
    flagReason: row.flagReason,
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
    },
    checkIn: row.checkIn ? toCheckIn(row.checkIn) : null,
  };
}
