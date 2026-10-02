import { Injectable } from "@nestjs/common";
import { prisma } from "@walkins/db";
import { type LiveBoard, liveBoardSchema, type LiveDisplay, liveDisplaySchema } from "@walkins/shared";

const BOARD_ARRIVALS = 12;

type Counts = LiveBoard["counts"];

// "Asha Kumari Rao" becomes "Asha R.": enough for someone in the queue to
// spot their own name, not enough to identify a stranger from a TV screen.
export function displayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Candidate";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

@Injectable()
export class LiveBoardService {
  async ownsDrive(companyId: string, driveId: string): Promise<boolean> {
    return (await prisma.drive.count({ where: { id: driveId, companyId } })) > 0;
  }

  // Confirmed counts everyone who took a booked seat, including those who
  // since arrived or were marked no-show; walk-ins never took a seat, so they
  // are counted apart rather than inflating either number.
  private async counts(driveId: string): Promise<Counts> {
    const [counts] = await prisma.$queryRaw<Counts[]>`
      SELECT
        (SELECT count(DISTINCT n."candidateId") FROM notifications n
          WHERE n."driveId" = ${driveId} AND n."templateKey" = 'drive_48h' AND n.status = 'SENT')::int AS alerted,
        count(*) FILTER (
          WHERE a.state NOT IN ('INTERESTED', 'WITHDRAWN') AND (ci.method IS NULL OR ci.method <> 'WALK_IN')
        )::int AS confirmed,
        count(*) FILTER (WHERE ci.id IS NOT NULL AND ci.method <> 'WALK_IN')::int AS "checkedIn",
        count(*) FILTER (WHERE ci.method = 'WALK_IN')::int AS "walkIns",
        count(*) FILTER (WHERE a.state = 'HIRED')::int AS hired
      FROM applications a
      LEFT JOIN check_ins ci ON ci."applicationId" = a.id
      WHERE a."driveId" = ${driveId}
    `;
    return counts;
  }

  // The employer's desk: everyone who has arrived, with what the desk needs
  // to act on them, and everyone still expected.
  async snapshot(driveId: string): Promise<LiveBoard> {
    const [counts, arrivals, awaiting] = await Promise.all([
      this.counts(driveId),
      prisma.checkIn.findMany({
        where: { application: { driveId } },
        include: { application: { include: { slot: true, candidate: { include: { user: { select: { name: true } } } } } } },
        orderBy: { scannedAt: "desc" },
      }),
      prisma.application.findMany({
        where: { driveId, state: { in: ["CONFIRMED", "NO_SHOW"] }, checkIn: { is: null } },
        include: { slot: true, candidate: { include: { user: { select: { name: true } } } } },
        orderBy: [{ slot: { startsAt: "asc" } }, { id: "asc" }],
      }),
    ]);

    return liveBoardSchema.parse({
      driveId,
      counts,
      arrivals: arrivals.map((checkIn) => ({
        checkInId: checkIn.id,
        applicationId: checkIn.applicationId,
        name: checkIn.application.candidate.user.name,
        state: checkIn.application.state,
        method: checkIn.method,
        scannedAt: checkIn.scannedAt.toISOString(),
        slotStartsAt: checkIn.application.slot?.startsAt.toISOString() ?? null,
        distanceMeters: checkIn.distanceMeters,
        isValid: checkIn.isValid,
        flagReason: checkIn.flagReason,
      })),
      awaiting: awaiting.map((application) => ({
        applicationId: application.id,
        name: application.candidate.user.name,
        state: application.state,
        slotStartsAt: application.slot?.startsAt.toISOString() ?? null,
      })),
    });
  }

  // The public board. Built from its own narrow query, never by trimming the
  // desk snapshot, so it can't carry what it was never given.
  async display(driveId: string): Promise<LiveDisplay> {
    const [drive, counts, arrivals] = await Promise.all([
      prisma.drive.findUniqueOrThrow({ where: { id: driveId }, include: { role: true, company: true } }),
      this.counts(driveId),
      prisma.checkIn.findMany({
        where: { application: { driveId } },
        select: {
          id: true,
          method: true,
          scannedAt: true,
          application: { select: { slot: { select: { startsAt: true } }, candidate: { select: { user: { select: { name: true } } } } } },
        },
        orderBy: { scannedAt: "desc" },
        take: BOARD_ARRIVALS,
      }),
    ]);

    return liveDisplaySchema.parse({
      driveId,
      roleTitle: drive.role.title,
      companyName: drive.company.name,
      venueAddress: drive.venueAddress,
      startsAt: drive.startsAt.toISOString(),
      endsAt: drive.endsAt.toISOString(),
      counts,
      arrivals: arrivals.map((checkIn) => ({
        checkInId: checkIn.id,
        displayName: displayName(checkIn.application.candidate.user.name),
        method: checkIn.method,
        scannedAt: checkIn.scannedAt.toISOString(),
        slotStartsAt: checkIn.application.slot?.startsAt.toISOString() ?? null,
      })),
    });
  }
}
