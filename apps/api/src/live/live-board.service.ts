import { Injectable } from "@nestjs/common";
import { prisma } from "@walkins/db";
import { type LiveBoard, liveBoardSchema } from "@walkins/shared";

const RECENT_ARRIVALS = 50;

type Counts = LiveBoard["counts"];

@Injectable()
export class LiveBoardService {
  async ownsDrive(companyId: string, driveId: string): Promise<boolean> {
    return (await prisma.drive.count({ where: { id: driveId, companyId } })) > 0;
  }

  // Confirmed counts everyone who took a booked seat, including those who
  // since arrived or were marked no-show; walk-ins never took a seat, so they
  // are counted apart rather than inflating either number.
  async snapshot(driveId: string): Promise<LiveBoard> {
    const [[counts], arrivals, awaiting] = await Promise.all([
      prisma.$queryRaw<Counts[]>`
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
      `,
      prisma.checkIn.findMany({
        where: { application: { driveId } },
        include: { application: { include: { slot: true, candidate: { include: { user: { select: { name: true } } } } } } },
        orderBy: { scannedAt: "desc" },
        take: RECENT_ARRIVALS,
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
}
