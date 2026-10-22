import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, prisma } from "@walkins/db";
import {
  addDays,
  dayKey,
  formatDate,
  OUTCOME_CORRECTION_DAYS,
  outcomeNeed,
  type Outcomes,
  outcomesSchema,
  type RecordOutcome,
  RETENTION_DAYS,
} from "@walkins/shared";
import { apiError } from "../common/api-error";
import { PERSON_SELECT, personRef, requireCompanyAccess } from "../common/require-company";

const OUTCOME_INCLUDE = {
  joiningDateBy: { select: PERSON_SELECT },
  startedBy: { select: PERSON_SELECT },
  retainedBy: { select: PERSON_SELECT },
  application: {
    include: {
      drive: { include: { role: { select: { title: true } } } },
      candidate: { include: { user: { select: { name: true } } } },
    },
  },
} as const;

type OutcomeRow = Prisma.HiringOutcomeGetPayload<{ include: typeof OUTCOME_INCLUDE }>;

// A @db.Date column comes back as midnight UTC of the stored day.
const asDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// The last day either side may still record or correct: some time after the
// joining date, or after the hire when no date was agreed.
export function editableUntil(o: { joiningDate: Date | null; hiredAt: Date }): string {
  return addDays(asDay(o.joiningDate) ?? dayKey(o.hiredAt), OUTCOME_CORRECTION_DAYS);
}

// What happened after the hire, recorded by the employer at the moments they
// already have reason to be here (on the desk as they hire, and when they
// come back for their next drive), with the candidate's own answer beside it.
@Injectable()
export class OutcomesService {
  // Hires still within reach of a correction, with whatever is due first.
  async list(userId: string, driveId?: string): Promise<Outcomes> {
    const { companyId } = await requireCompanyAccess(userId, "read");
    const today = dayKey(new Date());
    const rows = await prisma.hiringOutcome.findMany({
      where: { application: { state: "HIRED", drive: { companyId, ...(driveId ? { id: driveId } : {}) } } },
      include: OUTCOME_INCLUDE,
      orderBy: [{ joiningDate: { sort: "asc", nulls: "first" } }, { hiredAt: "desc" }],
    });
    const open = rows.filter((o) => editableUntil(o) >= today);
    const mapped = open.map((o) => this.toRow(o, companyId, today));
    return outcomesSchema.parse({ due: mapped.filter((r) => r.need !== null).length, rows: mapped });
  }

  async record(userId: string, applicationId: string, input: RecordOutcome) {
    const { companyId } = await requireCompanyAccess(userId, "runDrives");
    const outcome = await prisma.hiringOutcome.findFirst({
      where: { applicationId, application: { state: "HIRED", drive: { companyId } } },
      include: OUTCOME_INCLUDE,
    });
    if (!outcome) throw new NotFoundException(apiError("errors.outcomes.notHired"));
    const today = dayKey(new Date());
    if (editableUntil(outcome) < today) throw new ForbiddenException(apiError("errors.outcomes.tooLate", { day: formatDate(new Date(`${editableUntil(outcome)}T12:00:00+05:30`)) }));

    const now = new Date();
    const data: Prisma.HiringOutcomeUpdateInput = {};
    const joiningDate = input.joiningDate !== undefined ? input.joiningDate : asDay(outcome.joiningDate);
    if (input.joiningDate !== undefined) {
      if (input.joiningDate !== null && input.joiningDate < dayKey(outcome.hiredAt)) {
        throw new BadRequestException(apiError("errors.outcomes.joiningBeforeHire", {}, { field: "joiningDate" }));
      }
      Object.assign(data, { joiningDate: input.joiningDate ? new Date(input.joiningDate) : null, joiningDateBy: { connect: { id: userId } }, joiningDateRecordedAt: now });
    }

    const started = input.started !== undefined ? input.started : outcome.started;
    const startedOn = input.started === true ? (input.startedOn ?? joiningDate ?? today) : input.started === undefined ? asDay(outcome.startedOn) : null;
    if (input.started !== undefined) {
      // Whether someone started can't be known before the day they were due.
      if (input.started !== null && joiningDate && joiningDate > today) throw new BadRequestException(apiError("errors.outcomes.notYet"));
      if (startedOn && (startedOn > today || startedOn < dayKey(outcome.hiredAt))) {
        throw new BadRequestException(apiError("errors.outcomes.startedOnOutOfRange", {}, { field: "startedOn" }));
      }
      Object.assign(data, {
        started: input.started,
        startedOn: startedOn ? new Date(startedOn) : null,
        startedBy: { connect: { id: userId } },
        startedRecordedAt: now,
        // Staying is only a question for someone who started.
        ...(input.started !== true ? { retained: null, retainedBy: { disconnect: true }, retainedRecordedAt: null } : {}),
      });
    }

    if (input.retained !== undefined) {
      if (input.retained !== null && (started !== true || !startedOn || addDays(startedOn, RETENTION_DAYS) > today)) {
        throw new BadRequestException(apiError("errors.outcomes.retainedNotYet", { days: RETENTION_DAYS }));
      }
      Object.assign(data, { retained: input.retained, retainedBy: { connect: { id: userId } }, retainedRecordedAt: now });
    }

    await prisma.$transaction(async (tx) => {
      await tx.hiringOutcome.update({ where: { id: outcome.id }, data });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          entityType: "application",
          entityId: applicationId,
          action: "outcome_recorded",
          before: { joiningDate: asDay(outcome.joiningDate), started: outcome.started, startedOn: asDay(outcome.startedOn), retained: outcome.retained },
          after: input,
        },
      });
    });
    const updated = await prisma.hiringOutcome.findUniqueOrThrow({ where: { id: outcome.id }, include: OUTCOME_INCLUDE });
    return this.toRow(updated, companyId, today);
  }

  // The candidate's own answer, beside the employer's and never in place of
  // it. Only once the joining date has come, and within the same window.
  async candidateAnswer(userId: string, applicationId: string, started: boolean): Promise<void> {
    const outcome = await prisma.hiringOutcome.findFirst({ where: { applicationId, application: { state: "HIRED", candidate: { userId } } } });
    if (!outcome) throw new NotFoundException(apiError("errors.outcomes.notHired"));
    const today = dayKey(new Date());
    if (outcome.joiningDate && asDay(outcome.joiningDate)! > today) throw new BadRequestException(apiError("errors.outcomes.notYet"));
    if (editableUntil(outcome) < today) throw new ForbiddenException(apiError("errors.outcomes.tooLate", { day: formatDate(new Date(`${editableUntil(outcome)}T12:00:00+05:30`)) }));
    await prisma.$transaction([
      prisma.hiringOutcome.update({ where: { id: outcome.id }, data: { candidateStarted: started, candidateAnsweredAt: new Date() } }),
      prisma.auditLog.create({
        data: { actorUserId: userId, entityType: "application", entityId: applicationId, action: "outcome_answered", after: { started } },
      }),
    ]);
  }

  private toRow(o: OutcomeRow, companyId: string, today: string) {
    const fact = { joiningDate: asDay(o.joiningDate), started: o.started, startedOn: asDay(o.startedOn), retained: o.retained };
    return {
      applicationId: o.applicationId,
      driveId: o.application.driveId,
      roleTitle: o.application.drive.role.title,
      candidateName: o.application.candidate.user.name,
      driveStartsAt: o.application.drive.startsAt.toISOString(),
      hiredAt: o.hiredAt.toISOString(),
      ...fact,
      joiningDateBy: o.joiningDateBy ? personRef(o.joiningDateBy, companyId) : null,
      startedBy: o.startedBy ? personRef(o.startedBy, companyId) : null,
      retainedBy: o.retainedBy ? personRef(o.retainedBy, companyId) : null,
      candidateStarted: o.candidateStarted,
      candidateAnsweredAt: o.candidateAnsweredAt?.toISOString() ?? null,
      need: outcomeNeed(fact, today),
      editableUntil: editableUntil(o),
    };
  }
}
