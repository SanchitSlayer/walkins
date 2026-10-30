import { Injectable } from "@nestjs/common";
import { prisma } from "@walkins/db";
import { type LiveBoard, liveBoardSchema, type LiveDisplay, liveDisplaySchema, type PersonRef } from "@walkins/shared";
import { PERSON_SELECT, personRef, requireCompanyAccess } from "../common/require-company";

const BOARD_ARRIVALS = 12;

type Counts = LiveBoard["counts"];

// "Asha Kumari Rao" becomes "Asha R.": enough for someone in the queue to
// spot their own name, not enough to identify a stranger from a TV screen.
// Null when there is no name to shorten: OTP sign-up names an account by its
// phone number until the person gives a name, and a phone number on a
// screen facing the queue is exactly what this board must never show.
export function displayName(fullName: string, phone: string): string | null {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || fullName.trim() === phone) return null;
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${firstLetter(parts[parts.length - 1]).toUpperCase()}.`;
}

// The first letter as a reader sees it, not the first code unit: क्षत्रिय's
// initial is क्ष, a conjunct, where [0] would give a bare क.
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function firstLetter(word: string): string {
  return graphemes.segment(word)[Symbol.iterator]().next().value?.segment ?? word;
}

@Injectable()
export class LiveBoardService {
  // Anyone at the drive's company may watch it. Anyone else, including
  // someone who has left the company, gets the same answer as for a drive
  // that doesn't exist.
  async canWatch(userId: string, driveId: string): Promise<boolean> {
    const access = await requireCompanyAccess(userId, "read").catch(() => null);
    return access !== null && (await prisma.drive.count({ where: { id: driveId, companyId: access.companyId } })) > 0;
  }

  // Confirmed counts everyone who took a booked seat, including those who
  // since arrived or were marked no-show; walk-ins never took a seat, so they
  // are counted apart rather than inflating either number. Screened-out
  // applicants never held a seat, and someone rejected before arriving gave
  // theirs back, so neither counts as booked.
  private async counts(driveId: string): Promise<Counts> {
    const [counts] = await prisma.$queryRaw<Counts[]>`
      SELECT
        (SELECT count(DISTINCT n."candidateId") FROM notifications n
          WHERE n."driveId" = ${driveId} AND n."templateKey" = 'drive_48h' AND n.status = 'SENT')::int AS alerted,
        count(*) FILTER (
          WHERE a.state NOT IN ('INTERESTED', 'WITHDRAWN', 'SCREENED_OUT')
            AND NOT (a.state = 'REJECTED' AND ci.id IS NULL)
            AND (ci.method IS NULL OR ci.method <> 'WALK_IN')
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

    const actedBy = await this.deskActions(driveId, arrivals);
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
        capturedAt: checkIn.capturedAt?.toISOString() ?? null,
        slotStartsAt: checkIn.application.slot?.startsAt.toISOString() ?? null,
        distanceMeters: checkIn.distanceMeters,
        accuracyMeters: checkIn.accuracyMeters,
        isValid: checkIn.isValid,
        flags: checkIn.flags,
        lateBySeconds: checkIn.lateBySeconds,
        recordedBy: checkIn.method === "MANUAL" ? (actedBy.recorded.get(checkIn.applicationId) ?? null) : null,
        confirmedBy: actedBy.confirmed.get(checkIn.id) ?? null,
      })),
      awaiting: awaiting.map((application) => ({
        applicationId: application.id,
        name: application.candidate.user.name,
        state: application.state,
        slotStartsAt: application.slot?.startsAt.toISOString() ?? null,
      })),
    });
  }

  // Who at the desk did what, read from the audit log, which is the record
  // of it: marking someone present moves their application to CHECKED_IN
  // with the employer as actor, and confirming a flag is its own entry.
  private async deskActions(driveId: string, arrivals: { id: string; applicationId: string; method: string }[]) {
    const { companyId } = await prisma.drive.findUniqueOrThrow({ where: { id: driveId }, select: { companyId: true } });
    const manual = arrivals.filter((a) => a.method === "MANUAL").map((a) => a.applicationId);
    const rows = await prisma.auditLog.findMany({
      where: {
        actorUserId: { not: null },
        OR: [
          { entityType: "application", entityId: { in: manual }, action: { endsWith: "->CHECKED_IN" } },
          { entityType: "check_in", entityId: { in: arrivals.map((a) => a.id) }, action: "confirmed" },
        ],
      },
      include: { actor: { select: PERSON_SELECT } },
      orderBy: { createdAt: "asc" },
    });
    const recorded = new Map<string, PersonRef>();
    const confirmed = new Map<string, PersonRef>();
    for (const row of rows) {
      if (!row.actor) continue;
      (row.entityType === "check_in" ? confirmed : recorded).set(row.entityId, personRef(row.actor, companyId));
    }
    return { recorded, confirmed };
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
          application: { select: { slot: { select: { startsAt: true } }, candidate: { select: { user: { select: { name: true, phone: true } } } } } },
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
        displayName: displayName(checkIn.application.candidate.user.name, checkIn.application.candidate.user.phone),
        method: checkIn.method,
        scannedAt: checkIn.scannedAt.toISOString(),
        slotStartsAt: checkIn.application.slot?.startsAt.toISOString() ?? null,
      })),
    });
  }
}
