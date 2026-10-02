import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from "@nestjs/common";
import { type Actor, createApplication, prisma, StaleTransitionError, transitionApplication } from "@walkins/db";
import {
  type CheckInRequest,
  type CheckInResult,
  checkInResultSchema,
  type CheckInCode,
  checkInCodeSchema,
  formatTime,
} from "@walkins/shared";
import { toCheckIn } from "../applications/application.mapper";
import { isUniqueViolation } from "../common/prisma-errors";
import { RateLimiterService } from "../common/rate-limiter.service";
import { redis } from "../common/redis";
import { LiveGateway } from "../live/live.gateway";
import { CHECKIN_TOKEN_ROTATE_SECONDS, CheckInTokenService, OFFLINE_GRACE_MS } from "./check-in-token.service";

const GEOFENCE_METERS = 200;
const MAX_ACCURACY_METERS = 100;
const OPENS_BEFORE_START_MS = 60 * 60_000;

// Wrong codes allowed per 10 minutes before lookups are refused. The code is a
// 40-bit secret rather than a signed token, so guessing is what this limits.
// The per-address limit is higher because a venue's candidates may all share
// one Wi-Fi address and the occasional typo from each of them adds up.
const FAILED_CODE_WINDOW_SECONDS = 10 * 60;
const FAILED_CODES_PER_ACCOUNT = 10;
const FAILED_CODES_PER_ADDRESS = 60;

// Stops the same candidate replaying the same code after a successful
// check-in, and nothing more. It does not stop a photographed QR shared on
// WhatsApp: that is a different candidate, so a different key. Rotation (a
// code is dead within 90 seconds) and the 200 m geofence are what stop that.
// Concurrent duplicates are settled by the unique index on CheckIn.
function nonceKey(jti: string, candidateId: string) {
  return `checkin-nonce:${jti}:${candidateId}`;
}

function describeMeters(meters: number) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

@Injectable()
export class CheckInService {
  constructor(
    private readonly tokens: CheckInTokenService,
    private readonly live: LiveGateway,
    private readonly limiter: RateLimiterService,
  ) {}

  async issueCode(companyId: string, driveId: string): Promise<CheckInCode> {
    const drive = await prisma.drive.findFirst({ where: { id: driveId, companyId } });
    if (!drive) throw new NotFoundException("Drive not found");
    if (drive.status !== "LIVE" || drive.endsAt <= new Date()) {
      throw new BadRequestException("Check-in codes are only shown for a live drive that hasn't ended");
    }
    const { code, expiresAt } = await this.tokens.issueCode(driveId);
    return checkInCodeSchema.parse({
      code,
      expiresAt: expiresAt.toISOString(),
      rotateAfterSeconds: CHECKIN_TOKEN_ROTATE_SECONDS,
    });
  }

  async checkIn(userId: string, ip: string, input: CheckInRequest): Promise<CheckInResult> {
    const limits = [
      { key: `checkin-code:user:${userId}`, limit: FAILED_CODES_PER_ACCOUNT },
      { key: `checkin-code:ip:${ip}`, limit: FAILED_CODES_PER_ADDRESS },
    ];
    for (const { key, limit } of limits) {
      if (await this.limiter.isExhausted(key, limit, FAILED_CODE_WINDOW_SECONDS)) {
        throw new HttpException("Too many wrong codes. Wait a few minutes, then try the code on the screen.", HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    const token = await this.tokens.resolve(input.code);
    if (!token) {
      await Promise.all(limits.map(({ key, limit }) => this.limiter.consume(key, limit, FAILED_CODE_WINDOW_SECONDS)));
      throw new BadRequestException("That code isn't right, or it has expired. Check the code on the screen and try again.");
    }
    const now = new Date();
    const lateByMs = now.getTime() - token.expiresAt.getTime();
    if (lateByMs > OFFLINE_GRACE_MS) {
      throw new BadRequestException("This code has expired. Scan the code on the screen again.");
    }

    const candidate = await prisma.candidate.findUnique({ where: { userId }, select: { id: true } });
    if (!candidate) throw new BadRequestException("Save your profile before checking in");
    const key = nonceKey(token.jti, candidate.id);

    // A duplicate scan returns the existing check-in rather than an error.
    // The nonce only matters once that check-in is gone (removed by an
    // employer or a data fix): the code already used for it can't be
    // replayed to recreate it, and a fresh scan is needed.
    const usedBefore = (await redis.exists(key)) === 1;
    const existing = await this.findCheckIn(token.driveId, candidate.id);
    if (existing) return checkInResultSchema.parse({ outcome: "already_checked_in", checkIn: toCheckIn(existing) });
    if (usedBefore) throw new ConflictException("This code has already been used. Scan the code on the screen again.");

    const drive = await prisma.drive.findUnique({ where: { id: token.driveId }, include: { role: true, company: true } });
    if (!drive || drive.status !== "LIVE") throw new BadRequestException("This drive isn't open for check-in");

    // For a late offline sync the scan happened before the code expired; the
    // expiry is server-signed, so it stands in for the untrusted phone clock.
    const scannedAt = lateByMs > 0 ? token.expiresAt : now;
    const opensAt = new Date(drive.startsAt.getTime() - OPENS_BEFORE_START_MS);
    if (scannedAt < opensAt) {
      throw new BadRequestException(`Check-in opens at ${formatTime(opensAt.toISOString())}, an hour before the drive starts`);
    }
    if (scannedAt > drive.endsAt) throw new BadRequestException("This drive has ended");

    const application = await prisma.application.findUnique({
      where: { driveId_candidateId: { driveId: drive.id, candidateId: candidate.id } },
    });
    const booked = application?.state === "CONFIRMED";
    if (application?.state === "NO_SHOW") {
      throw new ConflictException("You were marked as not attending. Ask the employer at the desk to check you in.");
    }
    if (!booked && !input.walkIn) {
      return checkInResultSchema.parse({
        outcome: "needs_registration",
        drive: { id: drive.id, roleTitle: drive.role.title, companyName: drive.company.name },
      });
    }

    const [{ distanceMeters }] = await prisma.$queryRaw<{ distanceMeters: number }[]>`
      SELECT ST_Distance(d.geom, ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography) AS "distanceMeters"
      FROM drives d WHERE d.id = ${drive.id}
    `;
    const flags: string[] = [];
    if (input.accuracy > MAX_ACCURACY_METERS) {
      // Poor GPS indoors is common and not the candidate's fault, so this is
      // accepted and left to the employer rather than refused.
      flags.push(`Location only accurate to ±${describeMeters(input.accuracy)}, ${describeMeters(distanceMeters)} from the venue`);
    } else if (distanceMeters > GEOFENCE_METERS) {
      throw new BadRequestException(
        `You're ${describeMeters(distanceMeters)} from the venue. Check-in works within ${GEOFENCE_METERS} m; ` +
          "if you're here, ask the employer at the desk to check you in.",
      );
    }
    if (lateByMs > 0) {
      const minutes = Math.floor(lateByMs / 60_000);
      flags.push(`Scanned offline, sent ${minutes < 1 ? "less than a minute" : `${minutes} min`} after the code expired`);
    }

    const actor: Actor = { kind: "candidate", userId };
    const method = booked ? "SCAN" : "WALK_IN";
    try {
      const checkIn = await prisma.$transaction(async (tx) => {
        const moved = application
          ? await transitionApplication(tx, {
              applicationId: application.id,
              to: "CHECKED_IN",
              actor,
              reason: booked ? undefined : "walk-in",
            })
          : await createApplication(tx, {
              driveId: drive.id,
              candidateId: candidate.id,
              to: "CHECKED_IN",
              slotId: null,
              actor,
              reason: "walk-in",
            });
        return tx.checkIn.create({
          data: {
            applicationId: moved.id,
            method,
            capturedAt: input.capturedAt ?? null,
            lat: input.lat,
            lng: input.lng,
            accuracyMeters: input.accuracy,
            distanceMeters,
            isValid: flags.length === 0,
            flagReason: flags.join("; ") || null,
          },
        });
      });
      const ttlSeconds = Math.ceil((token.expiresAt.getTime() + OFFLINE_GRACE_MS - Date.now()) / 1000);
      await redis.set(key, "1", "EX", Math.max(ttlSeconds, 1));
      await this.live.publish(drive.id);
      return checkInResultSchema.parse({ outcome: "checked_in", checkIn: toCheckIn(checkIn) });
    } catch (err) {
      return this.resolveRace(err, drive.id, candidate.id);
    }
  }

  async markPresent(companyId: string, userId: string, applicationId: string, reason?: string): Promise<CheckInResult> {
    const application = await prisma.application.findFirst({
      where: { id: applicationId, drive: { companyId } },
      include: { checkIn: true },
    });
    if (!application) throw new NotFoundException("Application not found");
    if (application.checkIn) {
      return checkInResultSchema.parse({ outcome: "already_checked_in", checkIn: toCheckIn(application.checkIn) });
    }

    try {
      const checkIn = await prisma.$transaction(async (tx) => {
        await transitionApplication(tx, {
          applicationId,
          to: "CHECKED_IN",
          actor: { kind: "employer", userId },
          reason: reason || "marked present by the employer",
        });
        return tx.checkIn.create({ data: { applicationId, method: "MANUAL", isValid: true } });
      });
      await this.live.publish(application.driveId);
      return checkInResultSchema.parse({ outcome: "checked_in", checkIn: toCheckIn(checkIn) });
    } catch (err) {
      return this.resolveRace(err, application.driveId, application.candidateId);
    }
  }

  async confirmFlagged(companyId: string, userId: string, checkInId: string) {
    const checkIn = await prisma.checkIn.findFirst({
      where: { id: checkInId, application: { drive: { companyId } } },
      include: { application: { select: { driveId: true } } },
    });
    if (!checkIn) throw new NotFoundException("Check-in not found");
    if (checkIn.isValid) return toCheckIn(checkIn);

    const confirmed = await prisma.$transaction(async (tx) => {
      const updated = await tx.checkIn.update({ where: { id: checkInId }, data: { isValid: true } });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          entityType: "check_in",
          entityId: checkInId,
          action: "confirmed",
          before: { isValid: false, flagReason: checkIn.flagReason },
          after: { isValid: true },
        },
      });
      return updated;
    });
    await this.live.publish(checkIn.application.driveId);
    return toCheckIn(confirmed);
  }

  // A concurrent scan for the same person won: it created the application or
  // check-in first, or moved the state first. Its check-in is the answer.
  private async resolveRace(err: unknown, driveId: string, candidateId: string): Promise<CheckInResult> {
    if (isUniqueViolation(err) || err instanceof StaleTransitionError) {
      const existing = await this.findCheckIn(driveId, candidateId);
      if (existing) return checkInResultSchema.parse({ outcome: "already_checked_in", checkIn: toCheckIn(existing) });
    }
    throw err;
  }

  private findCheckIn(driveId: string, candidateId: string) {
    return prisma.checkIn.findFirst({ where: { application: { driveId, candidateId } } });
  }
}
