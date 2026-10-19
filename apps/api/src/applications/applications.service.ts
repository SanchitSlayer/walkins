import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { type Actor, createApplication, prisma, transitionApplication } from "@walkins/db";
import {
  type EmployerApplicationUpdate,
  evaluateKnockouts,
  type KnockoutAnswers,
  knockoutQuestionsSchema,
  type MyApplication,
  type MyApplications,
  myApplicationsSchema,
} from "@walkins/shared";
import { isUniqueViolation } from "../common/prisma-errors";
import { LiveGateway } from "../live/live.gateway";
import { MY_APPLICATION_INCLUDE, toMyApplication } from "./application.mapper";
import { apiError } from "../common/api-error";
import { requireCompanyAccess, requireNotSuspended } from "../common/require-company";

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

  // Filtering by company in the WHERE clause makes another company's
  // application indistinguishable from a missing one.
  async updateByEmployer(userId: string, applicationId: string, { to }: EmployerApplicationUpdate) {
    const { companyId } = await requireCompanyAccess(userId, "runDrives");
    const application = await prisma.application.findFirst({ where: { id: applicationId, drive: { companyId } }, include: { drive: { select: { status: true } } } });
    if (!application) throw new NotFoundException(apiError("errors.application.notFound"));
    requireNotSuspended(application.drive);
    const updated = await prisma.$transaction((tx) =>
      transitionApplication(tx, { applicationId, to, actor: { kind: "employer", userId } }),
    );
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
