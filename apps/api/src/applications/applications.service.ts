import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { type Actor, createApplication, prisma, transitionApplication } from "@walkins/db";
import { type EmployerApplicationUpdate, type MyApplication, type MyApplications, myApplicationsSchema } from "@walkins/shared";
import { isUniqueViolation } from "../common/prisma-errors";
import { LiveGateway } from "../live/live.gateway";
import { MY_APPLICATION_INCLUDE, toMyApplication } from "./application.mapper";

@Injectable()
export class ApplicationsService {
  constructor(private readonly live: LiveGateway) {}

  async apply(userId: string, driveId: string, slotId: string): Promise<MyApplication> {
    const candidate = await this.requireCandidate(userId);
    const drive = await prisma.drive.findFirst({ where: { id: driveId, status: "LIVE" } });
    if (!drive) throw new NotFoundException("Drive not found");
    const now = new Date();
    if (drive.endsAt <= now) throw new BadRequestException("This drive has ended");
    const slot = await prisma.driveSlot.findFirst({ where: { id: slotId, driveId } });
    if (!slot) throw new BadRequestException("That slot isn't part of this drive");
    if (slot.startsAt <= now) throw new BadRequestException("That slot has already started; pick a later one");

    const actor: Actor = { kind: "candidate", userId };
    let applicationId: string;
    try {
      applicationId = await prisma.$transaction(async (tx) => {
        const existing = await tx.application.findUnique({
          where: { driveId_candidateId: { driveId, candidateId: candidate.id } },
        });
        if (existing?.state === "CONFIRMED") throw new ConflictException("You're already booked for this drive");
        const application = existing
          ? await transitionApplication(tx, { applicationId: existing.id, to: "CONFIRMED", actor, slotId })
          : await createApplication(tx, { driveId, candidateId: candidate.id, to: "CONFIRMED", slotId, actor });
        return application.id;
      });
    } catch (err) {
      // A concurrent apply by the same candidate created the row first; the
      // unique constraint rejected this one and rolled back its seat.
      if (isUniqueViolation(err)) throw new ConflictException("You've already applied to this drive");
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
    if (!application) throw new NotFoundException("Application not found");
    if (application.drive.endsAt <= new Date()) throw new BadRequestException("This drive has ended");

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
  async updateByEmployer(companyId: string, userId: string, applicationId: string, { to }: EmployerApplicationUpdate) {
    const application = await prisma.application.findFirst({ where: { id: applicationId, drive: { companyId } } });
    if (!application) throw new NotFoundException("Application not found");
    const updated = await prisma.$transaction((tx) =>
      transitionApplication(tx, { applicationId, to, actor: { kind: "employer", userId } }),
    );
    await this.live.publish(application.driveId);
    return { id: updated.id, state: updated.state };
  }

  private async requireCandidate(userId: string) {
    const candidate = await prisma.candidate.findUnique({ where: { userId }, select: { id: true } });
    if (!candidate) throw new BadRequestException("Save your profile first");
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
