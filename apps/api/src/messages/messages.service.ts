import { randomUUID } from "node:crypto";
import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, prisma } from "@walkins/db";
import {
  type FlaggedMessage,
  type MessageDelivery,
  type MessageReport,
  moneyRequestSignals,
  type Thread,
  type ThreadBlock,
  type ThreadList,
  threadListSchema,
  threadSchema,
  THREAD_CLOSES_AFTER_DAYS,
} from "@walkins/shared";
import { apiError } from "../common/api-error";
import { JobsService } from "../common/jobs.service";
import { PERSON_SELECT, personRef, requireCompanyAccess } from "../common/require-company";

const DAY_MS = 24 * 3600_000;

const APPLICATION_INCLUDE = {
  drive: { include: { role: { select: { title: true } }, company: { select: { id: true, name: true, suspendedAt: true } } } },
  candidate: { include: { user: { select: { id: true, name: true } } } },
  thread: { include: { companyReadBy: { select: PERSON_SELECT } } },
} as const;

type ApplicationRow = Prisma.ApplicationGetPayload<{ include: typeof APPLICATION_INCLUDE }>;

type Side = "COMPANY" | "CANDIDATE";

export function closesAt(driveEndsAt: Date): Date {
  return new Date(driveEndsAt.getTime() + THREAD_CLOSES_AFTER_DAYS * DAY_MS);
}

// Every reason a side can't send right now. Worked out on each read and each
// send rather than by a job, so a thread closes at exactly its time, and a
// reschedule that moves the drive's end moves the close with it.
function blocks(application: ApplicationRow, side: Side, canRunDrives: boolean, now: Date): ThreadBlock[] {
  const found: ThreadBlock[] = [];
  if (now >= closesAt(application.drive.endsAt)) found.push("closed");
  if (application.state === "SCREENED_OUT" || application.state === "WITHDRAWN") found.push("applicationClosed");
  if (side === "COMPANY") {
    if (application.drive.company.suspendedAt) found.push("companySuspended");
    if (application.drive.status === "SUSPENDED") found.push("driveSuspended");
    if (!canRunDrives) found.push("viewOnly");
  }
  return found;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(private readonly jobs: JobsService) {}

  async companyThreads(userId: string, driveId?: string): Promise<ThreadList> {
    const { companyId } = await requireCompanyAccess(userId, "read");
    return this.list(Prisma.sql`d."companyId" = ${companyId} ${driveId ? Prisma.sql`AND d.id = ${driveId}` : Prisma.empty}`, "COMPANY");
  }

  async candidateThreads(userId: string): Promise<ThreadList> {
    return this.list(Prisma.sql`cu.id = ${userId}`, "CANDIDATE");
  }

  async companyThread(userId: string, applicationId: string): Promise<Thread> {
    const { application, canRunDrives } = await this.asCompany(userId, applicationId);
    return this.view(application, "COMPANY", canRunDrives);
  }

  async candidateThread(userId: string, applicationId: string): Promise<Thread> {
    return this.view(await this.asCandidate(userId, applicationId), "CANDIDATE", false);
  }

  async companySend(userId: string, applicationId: string, body: string): Promise<Thread> {
    const { application, canRunDrives } = await this.asCompany(userId, applicationId);
    await this.send(application, "COMPANY", userId, body, canRunDrives);
    return this.companyThread(userId, applicationId);
  }

  async candidateSend(userId: string, applicationId: string, body: string): Promise<Thread> {
    await this.send(await this.asCandidate(userId, applicationId), "CANDIDATE", userId, body, false);
    return this.candidateThread(userId, applicationId);
  }

  // Marks the thread read up to a seq the reader has seen, never past it, so
  // a message that arrived a moment later still counts as unread. The
  // company's marker is shared: whoever at the desk reads it, reads it for
  // the company, and is noted.
  async companyRead(userId: string, applicationId: string, seq: number): Promise<void> {
    await this.asCompany(userId, applicationId);
    await prisma.messageThread.updateMany({
      where: { applicationId, companyReadSeq: { lt: seq }, lastSeq: { gte: seq } },
      data: { companyReadSeq: seq, companyReadById: userId, companyReadAt: new Date() },
    });
  }

  async candidateRead(userId: string, applicationId: string, seq: number): Promise<void> {
    await this.asCandidate(userId, applicationId);
    await prisma.messageThread.updateMany({ where: { applicationId, candidateReadSeq: { lt: seq }, lastSeq: { gte: seq } }, data: { candidateReadSeq: seq } });
  }

  // Either side may report a message from the other, into the same
  // moderation queue as drives and candidates.
  async report(userId: string, messageId: string, input: MessageReport): Promise<{ received: true }> {
    const message = await prisma.message.findUnique({ where: { id: messageId }, include: { thread: { select: { applicationId: true } } } });
    if (!message) throw new NotFoundException(apiError("errors.messages.notFound"));
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
    const mine: Side = user.role === "CANDIDATE" ? "CANDIDATE" : "COMPANY";
    if (mine === "CANDIDATE") await this.asCandidate(userId, message.thread.applicationId);
    else await this.asCompany(userId, message.thread.applicationId);
    if (message.side === mine) throw new ForbiddenException(apiError("errors.messages.reportOwnSide"));

    const repeat = await prisma.report.count({ where: { messageId, reporterUserId: userId, reason: input.reason } });
    if (repeat === 0) {
      await prisma.report.create({ data: { targetType: "MESSAGE", messageId, reason: input.reason, details: input.details || null, reporterUserId: userId } });
    }
    return { received: true };
  }

  // For owners: what the tripwire caught from their own people, until an
  // owner has looked at it.
  async flagged(userId: string): Promise<FlaggedMessage[]> {
    const { companyId } = await requireCompanyAccess(userId, "managePeople");
    const rows = await prisma.message.findMany({
      where: { moneyFlag: true, flagReviewedAt: null, thread: { application: { drive: { companyId } } } },
      include: {
        sender: { select: PERSON_SELECT },
        thread: { include: { application: { include: { drive: { include: { role: true } }, candidate: { include: { user: { select: { name: true } } } } } } } },
      },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((m) => ({
      messageId: m.id,
      applicationId: m.thread.applicationId,
      driveId: m.thread.application.driveId,
      roleTitle: m.thread.application.drive.role.title,
      candidateName: m.thread.application.candidate.user.name,
      sender: personRef(m.sender, companyId),
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    }));
  }

  async reviewFlag(userId: string, messageId: string): Promise<void> {
    const { companyId } = await requireCompanyAccess(userId, "managePeople");
    const { count } = await prisma.message.updateMany({
      where: { id: messageId, moneyFlag: true, flagReviewedAt: null, thread: { application: { drive: { companyId } } } },
      data: { flagReviewedAt: new Date(), flagReviewedById: userId },
    });
    if (count === 0) throw new NotFoundException(apiError("errors.messages.notFound"));
  }

  // An admin reads a thread only once a message in it has been reported, and
  // every time is audited: messages are not otherwise open to Walkins.
  async adminThread(adminId: string, threadId: string): Promise<Thread> {
    const thread = await prisma.messageThread.findUnique({ where: { id: threadId }, select: { applicationId: true, messages: { where: { reports: { some: {} } }, take: 1 } } });
    if (!thread || thread.messages.length === 0) throw new NotFoundException(apiError("errors.messages.notReported"));
    const application = await prisma.application.findUniqueOrThrow({ where: { id: thread.applicationId }, include: APPLICATION_INCLUDE });
    await prisma.auditLog.create({ data: { actorUserId: adminId, entityType: "thread", entityId: threadId, action: "viewed_by_admin" } });
    return this.view(application, "COMPANY", false, false);
  }

  private async asCompany(userId: string, applicationId: string) {
    const access = await requireCompanyAccess(userId, "read");
    const application = await prisma.application.findFirst({ where: { id: applicationId, drive: { companyId: access.companyId } }, include: APPLICATION_INCLUDE });
    if (!application) throw new NotFoundException(apiError("errors.application.notFound"));
    return { application, canRunDrives: access.role !== "VIEWER" };
  }

  private async asCandidate(userId: string, applicationId: string) {
    const application = await prisma.application.findFirst({ where: { id: applicationId, candidate: { userId } }, include: APPLICATION_INCLUDE });
    if (!application) throw new NotFoundException(apiError("errors.application.notFound"));
    return application;
  }

  // The message is committed with its place in the thread before anything
  // else happens; the thread is the record. Two people sending at once each
  // take the thread row's lock in turn, so each gets the next seq and every
  // reader sees the same order. The Telegram copy is queued afterwards and
  // never awaited into the response: if queueing fails, the sweep finds
  // the message within 15 minutes, and the sender doesn't retry into a
  // duplicate.
  private async send(application: ApplicationRow, side: Side, senderId: string, body: string, canRunDrives: boolean) {
    const blocked = blocks(application, side, canRunDrives, new Date());
    if (blocked.length > 0) throw new ForbiddenException(apiError(`errors.messages.blocked.${blocked[0]}`));
    // Only the company's messages: the scam runs from employer to candidate,
    // and a candidate asking "is there a fee?" is a warning sign about the
    // employer, not one to file against the candidate.
    const flagged = side === "COMPANY" && moneyRequestSignals(body).length > 0;

    const message = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO message_threads (id, "applicationId") VALUES (${randomUUID()}, ${application.id}) ON CONFLICT ("applicationId") DO NOTHING`;
      const [thread] = await tx.$queryRaw<{ id: string; lastSeq: number }[]>`
        UPDATE message_threads SET "lastSeq" = "lastSeq" + 1, "lastMessageAt" = ${new Date()}
        WHERE "applicationId" = ${application.id}
        RETURNING id, "lastSeq"
      `;
      const created = await tx.message.create({ data: { threadId: thread.id, seq: thread.lastSeq, side, senderId, body, moneyFlag: flagged } });
      if (flagged) {
        await tx.report.create({ data: { targetType: "MESSAGE", messageId: created.id, reason: "ASKS_FOR_MONEY" } });
      }
      return created;
    });

    if (side === "COMPANY") {
      this.jobs
        .message({ driveId: application.driveId, candidateId: application.candidateId, messageId: message.id })
        .catch((err) => this.logger.error(`Couldn't queue the Telegram copy of message ${message.id}; the sweep will pick it up`, err));
    }
  }

  private async view(application: ApplicationRow, side: Side, canRunDrives: boolean, withReadNote = true): Promise<Thread> {
    const now = new Date();
    const thread = application.thread;
    const messages = thread
      ? await prisma.message.findMany({
          where: { threadId: thread.id },
          include: { sender: { select: PERSON_SELECT }, notifications: { orderBy: { createdAt: "desc" }, take: 1 } },
          orderBy: { seq: "asc" },
        })
      : [];
    const companyId = application.drive.company.id;
    const linked = application.candidate.telegramChatId !== null;
    const delivery = (m: (typeof messages)[number]): MessageDelivery | null => {
      if (side !== "COMPANY" || m.side !== "COMPANY") return null;
      const latest = m.notifications[0];
      if (latest?.status === "SENT") return "telegram";
      if (latest?.status === "FAILED") return "failed";
      if (latest?.status === "SKIPPED") return "inAppOnly";
      return linked ? "pending" : "inAppOnly";
    };
    const readSeq = side === "COMPANY" ? (thread?.companyReadSeq ?? 0) : (thread?.candidateReadSeq ?? 0);
    const other: Side = side === "COMPANY" ? "CANDIDATE" : "COMPANY";

    return threadSchema.parse({
      applicationId: application.id,
      drive: {
        id: application.drive.id,
        roleTitle: application.drive.role.title,
        companyName: application.drive.company.name,
        startsAt: application.drive.startsAt.toISOString(),
        endsAt: application.drive.endsAt.toISOString(),
      },
      candidateName: application.candidate.user.name,
      canSend: blocks(application, side, canRunDrives, now).length === 0,
      blockedBy: blocks(application, side, canRunDrives, now),
      closesAt: closesAt(application.drive.endsAt).toISOString(),
      telegramLinked: side === "COMPANY" ? linked : null,
      lastReadBy:
        side === "COMPANY" && withReadNote && thread?.companyReadBy && thread.companyReadAt
          ? { person: personRef(thread.companyReadBy, companyId), at: thread.companyReadAt.toISOString() }
          : null,
      unread: messages.filter((m) => m.side === other && m.seq > readSeq).length,
      messages: messages.map((m) => ({
        id: m.id,
        seq: m.seq,
        side: m.side,
        sender: m.side === "COMPANY" ? personRef(m.sender, companyId) : null,
        body: m.body,
        moneyFlag: m.moneyFlag,
        createdAt: m.createdAt.toISOString(),
        delivery: delivery(m),
      })),
    });
  }

  private async list(scope: Prisma.Sql, side: Side): Promise<ThreadList> {
    const rows = await prisma.$queryRaw<
      { applicationId: string; driveId: string; roleTitle: string; companyName: string; candidateName: string; lastMessageAt: Date; unread: number }[]
    >`
      SELECT t."applicationId", d.id AS "driveId", r.title AS "roleTitle", co.name AS "companyName", cu.name AS "candidateName",
        t."lastMessageAt",
        (SELECT count(*) FROM messages m WHERE m."threadId" = t.id
           AND m.side = ${side === "COMPANY" ? "CANDIDATE" : "COMPANY"}::"MessageSide"
           AND m.seq > ${side === "COMPANY" ? Prisma.sql`t."companyReadSeq"` : Prisma.sql`t."candidateReadSeq"`})::int AS unread
      FROM message_threads t
      JOIN applications a ON a.id = t."applicationId"
      JOIN drives d ON d.id = a."driveId"
      JOIN roles r ON r.id = d."roleId"
      JOIN companies co ON co.id = d."companyId"
      JOIN candidates c ON c.id = a."candidateId"
      JOIN users cu ON cu.id = c."userId"
      WHERE t."lastSeq" > 0 AND ${scope}
      ORDER BY t."lastMessageAt" DESC
    `;
    return threadListSchema.parse({
      threads: rows.map((r) => ({ ...r, lastMessageAt: r.lastMessageAt.toISOString() })),
      unread: rows.reduce((sum, r) => sum + r.unread, 0),
    });
  }
}
