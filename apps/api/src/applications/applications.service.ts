import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { absenceExcusedByReschedule, type Actor, type ApplicationState, createApplication, prisma, transitionApplication } from "@walkins/db";
import {
  type CandidateRecord,
  candidateRecordSchema,
  type EmployerApplicationUpdate,
  evaluateKnockouts,
  type KnockoutAnswers,
  knockoutQuestionsSchema,
  type MyApplication,
  type MyApplications,
  myApplicationsSchema,
  type RecordEntryState,
} from "@walkins/shared";
import { isUniqueViolation } from "../common/prisma-errors";
import { LiveGateway } from "../live/live.gateway";
import { MY_APPLICATION_INCLUDE, toMyApplication } from "./application.mapper";
import { apiError } from "../common/api-error";
import { requireCompanyAccess, requireNotSuspended } from "../common/require-company";

// What the record says happened, from what was scanned first: someone who
// came, came, whatever was decided after.
function recordState(r: { state: string; driveStatus: string; validCheckIn: boolean | null; excused: boolean }): RecordEntryState {
  if (r.validCheckIn === true) return "attended";
  if (r.validCheckIn === false) return "awaitingConfirmation";
  if (r.state === "NO_SHOW") return r.excused ? "notAttendedExcused" : "notAttended";
  if (r.state === "WITHDRAWN") return "withdrawn";
  if (r.state === "SCREENED_OUT") return "screenedOut";
  if (r.state === "REJECTED") return "turnedAway";
  if (r.driveStatus === "CANCELLED") return "driveCancelled";
  if (r.driveStatus === "SUSPENDED") return "drivePaused";
  return "booked";
}

@Injectable()
export class ApplicationsService {
  constructor(private readonly live: LiveGateway) {}

  async apply(userId: string, driveId: string, slotId: string, answers: KnockoutAnswers): Promise<MyApplication> {
    const candidate = await this.requireCandidate(userId);
    const drive = await prisma.drive.findFirst({ where: { id: driveId, status: { in: ["LIVE", "SUSPENDED"] } } });
    if (!drive) throw new NotFoundException(apiError("errors.drive.notFound"));
    if (drive.status === "SUSPENDED") throw new BadRequestException(apiError("errors.application.suspended"));
    const now = new Date();
    if (drive.endsAt <= now) throw new BadRequestException(apiError("errors.application.driveEnded"));
    const slot = await prisma.driveSlot.findFirst({ where: { id: slotId, driveId } });
    if (!slot) throw new BadRequestException(apiError("errors.application.slotNotInDrive"));
    if (slot.startsAt <= now) throw new BadRequestException(apiError("errors.application.slotStarted"));

    // Judged before any seat is touched. A malformed answer is a bad request;
    // an unmet requirement is a decision, recorded with the employer's own
    // wording of what was needed so the candidate knows not to travel.
    const verdict = evaluateKnockouts(knockoutQuestionsSchema.parse(drive.knockoutQuestions), answers);
    if (!verdict.passed && "invalid" in verdict) throw new BadRequestException(apiError(verdict.invalid.key, { prompt: verdict.invalid.prompt }));
    const screenedOutReason = verdict.passed ? null : verdict.reason;
    const to = screenedOutReason ? "SCREENED_OUT" : "CONFIRMED";

    const actor: Actor = { kind: "candidate", userId };
    let applicationId: string;
    try {
      applicationId = await prisma.$transaction(async (tx) => {
        const existing = await tx.application.findUnique({
          where: { driveId_candidateId: { driveId, candidateId: candidate.id } },
        });
        if (existing?.state === "CONFIRMED") throw new ConflictException(apiError("errors.application.alreadyBooked"));
        if (existing?.state === "SCREENED_OUT") {
          throw new ConflictException(apiError("errors.application.screenedOut", { requirement: existing.screenedOutReason ?? "" }));
        }
        const application = existing
          ? await transitionApplication(tx, { applicationId: existing.id, to, actor, ...(to === "CONFIRMED" ? { slotId } : {}) })
          : await createApplication(tx, { driveId, candidateId: candidate.id, to, slotId: to === "CONFIRMED" ? slotId : null, actor });
        await tx.application.update({ where: { id: application.id }, data: { knockoutAnswers: answers, screenedOutReason } });
        return application.id;
      });
    } catch (err) {
      // A concurrent apply by the same candidate created the row first; the
      // unique constraint rejected this one and rolled back its seat.
      if (isUniqueViolation(err)) throw new ConflictException(apiError("errors.application.alreadyApplied"));
      throw err;
    }
    await this.live.publish(driveId);
    return this.findMine(candidate.id, applicationId);
  }

  async release(userId: string, applicationId: string): Promise<MyApplication> {
    const candidate = await this.requireCandidate(userId);
    const application = await prisma.application.findFirst({
      where: { id: applicationId, candidateId: candidate.id },
      include: { drive: true },
    });
    if (!application) throw new NotFoundException(apiError("errors.application.notFound"));
    if (application.drive.endsAt <= new Date()) throw new BadRequestException(apiError("errors.application.driveEnded"));

    await prisma.$transaction((tx) =>
      transitionApplication(tx, { applicationId, to: "WITHDRAWN", actor: { kind: "candidate", userId } }),
    );
    await this.live.publish(application.driveId);
    return this.findMine(candidate.id, applicationId);
  }

  async listMine(userId: string): Promise<MyApplications> {
    const candidate = await this.requireCandidate(userId);
    const now = new Date();
    const rows = await prisma.application.findMany({
      where: { candidateId: candidate.id },
      include: MY_APPLICATION_INCLUDE,
      orderBy: { drive: { startsAt: "asc" } },
    });
    return myApplicationsSchema.parse({
      upcoming: rows.filter((row) => row.drive.endsAt > now).map(toMyApplication),
      past: rows
        .filter((row) => row.drive.endsAt <= now)
        .reverse()
        .map(toMyApplication),
    });
  }

  // The candidate's own record: what they applied to and what was recorded,
  // built field by field into a shape that has room for nothing else.
  async myRecord(userId: string): Promise<CandidateRecord> {
    const candidate = await this.requireCandidate(userId);
    const rows = await prisma.$queryRaw<
      {
        applicationId: string;
        state: ApplicationState;
        roleTitle: string;
        companyName: string;
        driveStartsAt: Date;
        driveStatus: string;
        validCheckIn: boolean | null;
        markedAbsentAt: Date | null;
        excused: boolean;
      }[]
    >`
      SELECT a.id AS "applicationId", a.state, r.title AS "roleTitle", co.name AS "companyName",
        d."startsAt" AS "driveStartsAt", d.status AS "driveStatus", ci."isValid" AS "validCheckIn",
        (SELECT max(al."createdAt") FROM audit_logs al WHERE al."entityType" = 'application' AND al."entityId" = a.id AND al.action LIKE '%->NO_SHOW') AS "markedAbsentAt",
        (a.state = 'NO_SHOW' AND ${absenceExcusedByReschedule}) AS excused
      FROM applications a
      JOIN drives d ON d.id = a."driveId"
      JOIN roles r ON r.id = d."roleId"
      JOIN companies co ON co.id = d."companyId"
      LEFT JOIN check_ins ci ON ci."applicationId" = a.id
      WHERE a."candidateId" = ${candidate.id} AND a.state <> 'INTERESTED'
      ORDER BY d."startsAt" DESC
    `;
    const outcomes = await prisma.hiringOutcome.findMany({ where: { applicationId: { in: rows.map((r) => r.applicationId) } } });
    const byApplication = new Map(outcomes.map((o) => [o.applicationId, o]));
    const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

    return candidateRecordSchema.parse({
      entries: rows.map((r) => {
        const outcome = byApplication.get(r.applicationId);
        return {
          applicationId: r.applicationId,
          roleTitle: r.roleTitle,
          companyName: r.companyName,
          driveStartsAt: r.driveStartsAt.toISOString(),
          state: recordState(r),
          markedAbsentAt: r.state === "NO_SHOW" ? (r.markedAbsentAt?.toISOString() ?? null) : null,
          hired: r.state === "HIRED",
          after: outcome
            ? {
                joiningDate: day(outcome.joiningDate),
                started: outcome.started,
                startedOn: day(outcome.startedOn),
                retained: outcome.retained,
                yourAnswer: outcome.candidateStarted,
              }
            : null,
        };
      }),
    });
  }

  // Filtering by company in the WHERE clause makes another company's
  // application indistinguishable from a missing one.
  async updateByEmployer(userId: string, applicationId: string, { to }: EmployerApplicationUpdate) {
    const { companyId } = await requireCompanyAccess(userId, "runDrives");
    const application = await prisma.application.findFirst({ where: { id: applicationId, drive: { companyId } }, include: { drive: { select: { status: true } } } });
    if (!application) throw new NotFoundException(apiError("errors.application.notFound"));
    requireNotSuspended(application.drive);
    // A hire opens its outcome record in the same step, every fact unknown,
    // so what happens after has somewhere to be written.
    const updated = await prisma.$transaction(async (tx) => {
      const moved = await transitionApplication(tx, { applicationId, to, actor: { kind: "employer", userId } });
      if (to === "HIRED") await tx.hiringOutcome.create({ data: { applicationId, hiredAt: new Date() } });
      return moved;
    });
    await this.live.publish(application.driveId);
    return { id: updated.id, state: updated.state };
  }

  private async requireCandidate(userId: string) {
    const candidate = await prisma.candidate.findUnique({ where: { userId }, select: { id: true } });
    if (!candidate) throw new BadRequestException(apiError("errors.profile.saveFirst"));
    return candidate;
  }

  private async findMine(candidateId: string, applicationId: string): Promise<MyApplication> {
    const row = await prisma.application.findFirstOrThrow({
      where: { id: applicationId, candidateId },
      include: MY_APPLICATION_INCLUDE,
    });
    return toMyApplication(row);
  }
}
