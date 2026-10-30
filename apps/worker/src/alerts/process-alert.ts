import { UnrecoverableError } from "bullmq";
import { Prisma, prisma } from "@walkins/db";
import {
  type AlertJob,
  alertJobId,
  ChannelRateLimitedError,
  DeliveryOutcomeUnknownError,
  NotImplementedError,
  type DriveStatus,
  type Recipient,
  RecipientUnreachableError,
  type TemplatedMessage,
  type TemplateKey,
  localePath,
  servedLocale,
} from "@walkins/shared";
import type { ChannelResolver } from "../channels/channel-resolver";
import { type AlertContext, renderAlert, renderMessage } from "./templates";

export type AlertAttempt = {
  data: AlertJob;
  attemptsMade: number;
};

export type ProcessDeps = {
  resolver: ChannelResolver;
  webUrl: string;
  // Pauses the whole queue and returns the error that puts this job back
  // without spending one of its attempts.
  onRateLimited: (retryAfterMs: number) => Promise<Error>;
};

type Loaded = { skip: string } | { recipient: Recipient; message: TemplatedMessage };

// The statuses a drive must still be in for each alert to be true when it
// arrives: a suspension notice for a drive already put back on, or a "back
// on" for one suspended again, is skipped rather than sent.
const DRIVE_STATUS_FOR: Record<Exclude<TemplateKey, "message">, DriveStatus[]> = {
  drive_48h: ["LIVE"],
  drive_morning_of: ["LIVE"],
  application_rejected: ["LIVE"],
  drive_cancelled: ["CANCELLED"],
  drive_suspended: ["SUSPENDED"],
  drive_reinstated: ["LIVE"],
  drive_rescheduled: ["LIVE"],
  joining_check: ["LIVE", "EXPIRED"],
};

// Sent to everyone holding a seat, so each is skipped for anyone who has
// since released it or been checked in.
const TO_BOOKED: TemplateKey[] = ["drive_morning_of", "drive_cancelled", "drive_suspended", "drive_reinstated", "drive_rescheduled"];

// The time the candidate last knew, for a reschedule notice to say what it
// was. Two reschedules in quick succession send only the latest notice, so
// "was" is the time before the first change they haven't been told about,
// never an in-between time nobody announced to them. Someone who booked
// after a change already knew its new time. Null when there is nothing they
// haven't been told.
async function lastKnownTime(driveId: string, candidateId: string, bookedAt: Date) {
  const [told, seen] = await Promise.all([
    prisma.notification.findFirst({
      where: { driveId, candidateId, templateKey: "drive_rescheduled", status: "SENT" },
      orderBy: { scheduleVersion: "desc" },
      select: { scheduleVersion: true },
    }),
    prisma.driveReschedule.findFirst({ where: { driveId, createdAt: { lte: bookedAt } }, orderBy: { version: "desc" }, select: { version: true } }),
  ]);
  const known = Math.max(told?.scheduleVersion ?? 0, seen?.version ?? 0);
  const next = await prisma.driveReschedule.findFirst({ where: { driveId, version: known + 1 } });
  return next ? { startsAt: next.fromStartsAt.toISOString(), endsAt: next.fromEndsAt.toISOString() } : null;
}

// A message's Telegram copy. Nothing can make it untrue once sent, so it is
// never skipped for the drive or the thread changing: only for a candidate
// with no channel, recorded so the sweep doesn't queue it again.
async function loadMessage(messageId: string, webUrl: string): Promise<Loaded | null> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      sender: { select: { name: true } },
      thread: { include: { application: { include: { drive: { include: { role: true, company: true } }, candidate: { include: { user: { select: { phone: true, locale: true } } } } } } } },
    },
  });
  if (!message) return null;
  const { application } = message.thread;
  const locale = servedLocale(application.candidate.user.locale);
  return {
    recipient: { candidateId: application.candidateId, phone: application.candidate.user.phone, telegramChatId: application.candidate.telegramChatId },
    message: renderMessage(
      {
        sender: message.sender.name,
        company: application.drive.company.name,
        role: application.drive.role.title,
        body: message.body,
        flagged: message.moneyFlag,
        threadUrl: `${webUrl}${localePath(`/my-drives/messages/${application.id}`, locale)}`,
      },
      locale,
    ),
  };
}

async function loadAlert({ driveId, candidateId, templateKey, scheduleVersion }: AlertJob, now: Date, webUrl: string): Promise<Loaded | null> {
  if (templateKey === "message") return null;
  const [drive, candidate] = await Promise.all([
    prisma.drive.findUnique({ where: { id: driveId }, include: { role: true, company: true } }),
    prisma.candidate.findUnique({ where: { id: candidateId }, include: { user: { select: { phone: true, locale: true } } } }),
  ]);
  if (!drive || !candidate) return null;
  if (!DRIVE_STATUS_FOR[templateKey].includes(drive.status)) return { skip: `drive is ${drive.status.toLowerCase()}` };
  // Every other alert is about the drive day; this one comes after it.
  if (templateKey !== "joining_check" && drive.endsAt <= now) return { skip: "drive has ended" };
  if (scheduleVersion !== undefined && scheduleVersion !== drive.scheduleVersion) return { skip: "the drive has been rescheduled since" };

  let slotStartsAt: string | null = null;
  let previous: { startsAt: string; endsAt: string } | null = null;
  let joiningDate: string | null = null;
  if (templateKey === "drive_48h") {
    // Targeting leaves applicants out, but only at the moment of fanout; a
    // job queued before they applied is still waiting. Any application,
    // even a withdrawn one, means they have already found this drive.
    const applied = await prisma.application.count({ where: { driveId, candidateId } });
    if (applied > 0) return { skip: "candidate has since applied" };
  } else if (TO_BOOKED.includes(templateKey)) {
    const application = await prisma.application.findFirst({
      where: { driveId, candidateId, state: "CONFIRMED" },
      include: { slot: true },
    });
    if (!application) return { skip: "candidate is no longer confirmed" };
    slotStartsAt = application.slot?.startsAt.toISOString() ?? null;
    if (templateKey === "drive_rescheduled") {
      previous = await lastKnownTime(driveId, candidateId, application.stateChangedAt);
      if (!previous) return { skip: "candidate already knows this time" };
    }
  } else if (templateKey === "joining_check") {
    const outcome = await prisma.hiringOutcome.findFirst({ where: { application: { driveId, candidateId, state: "HIRED" } } });
    if (!outcome?.joiningDate) return { skip: "no joining date to ask about" };
    if (outcome.candidateStarted !== null) return { skip: "candidate has already answered" };
    joiningDate = outcome.joiningDate.toISOString().slice(0, 10);
  } else if (templateKey === "application_rejected") {
    const rejected = await prisma.application.count({ where: { driveId, candidateId, state: "REJECTED" } });
    if (rejected === 0) return { skip: "application is no longer rejected" };
  }

  const [{ distanceMeters }] = await prisma.$queryRaw<{ distanceMeters: number }[]>`
    SELECT ST_Distance(c.geom, d.geom) AS "distanceMeters"
    FROM candidates c, drives d
    WHERE c.id = ${candidateId} AND d.id = ${driveId}
  `;

  const locale = servedLocale(candidate.user.locale);
  const link = (path: string) => `${webUrl}${localePath(path, locale)}`;
  const context: AlertContext = {
      roleTitle: drive.role.title,
      companyName: drive.company.name,
      salaryMin: drive.salaryMin,
      salaryMax: drive.salaryMax,
      distanceKm: distanceMeters / 1000,
      venueAddress: drive.venueAddress,
      startsAt: drive.startsAt.toISOString(),
      endsAt: drive.endsAt.toISOString(),
      slotStartsAt,
      previous,
      joiningDate,
      // A rejection or a cancellation points to other drives rather than the
      // one that is no longer for them.
      driveUrl:
        templateKey === "joining_check"
          ? link("/my-drives")
          : templateKey === "application_rejected" || templateKey === "drive_cancelled"
            ? link("/")
            : link(`/drives/${driveId}`),
      reportUrl: link(`/drives/${driveId}#report`),
  };
  return { recipient: { candidateId, phone: candidate.user.phone, telegramChatId: candidate.telegramChatId }, message: renderAlert(templateKey, context, now, locale) };
}

// Every attempt leaves a notifications row. The PENDING row inserted before
// the provider call is the claim: a partial unique index lets only one
// PENDING or SENT row exist per alert (per drive, candidate, template and
// schedule version) or per message, so a retry, a redelivered stalled job or
// a duplicate job cannot get past it once a send has started.
export async function processAlert({ data, attemptsMade }: AlertAttempt, deps: ProcessDeps): Promise<string> {
  const { driveId, candidateId, templateKey } = data;
  const now = new Date();
  const version = data.scheduleVersion ?? 0;
  const messageId = data.messageId ?? null;
  const row = { driveId, candidateId, templateKey, scheduleVersion: version, messageId, attempt: attemptsMade + 1, jobId: alertJobId(data) };

  const claimed = await prisma.notification.findFirst({
    where: { ...(messageId ? { messageId } : { driveId, candidateId, templateKey, scheduleVersion: version, messageId: null }), status: { in: ["PENDING", "SENT"] } },
    select: { id: true },
  });
  if (claimed) return "already sent";

  const loaded = messageId ? await loadMessage(messageId, deps.webUrl) : await loadAlert(data, now, deps.webUrl);
  if (!loaded) return "drive or candidate no longer exists";
  if ("skip" in loaded) {
    await prisma.notification.create({ data: { ...row, channel: "none", status: "SKIPPED", error: loaded.skip } });
    return `skipped: ${loaded.skip}`;
  }

  const channel = deps.resolver.resolve(loaded.recipient);
  if (!channel) {
    await prisma.notification.create({
      data: { ...row, channel: "none", status: "SKIPPED", error: "no channel can reach this candidate" },
    });
    return "skipped: no channel";
  }

  let claimId: string;
  try {
    ({ id: claimId } = await prisma.notification.create({
      data: { ...row, channel: channel.name, status: "PENDING" },
      select: { id: true },
    }));
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "already claimed";
    throw err;
  }

  try {
    const result = await channel.send(loaded.recipient, loaded.message);
    await prisma.notification.update({
      where: { id: claimId },
      data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerMessageId },
    });
    return `sent via ${channel.name}`;
  } catch (err) {
    const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (err instanceof DeliveryOutcomeUnknownError) {
      // The claim stays PENDING so nothing sends this alert again; the job
      // goes to the dead-letter list for a person to check.
      await prisma.notification.update({ where: { id: claimId }, data: { error } });
      throw new UnrecoverableError(error);
    }
    // FAILED releases the claim: the provider definitely did not deliver.
    await prisma.notification.update({ where: { id: claimId }, data: { status: "FAILED", error } });
    if (err instanceof ChannelRateLimitedError) throw await deps.onRateLimited(err.retryAfterMs);
    if (err instanceof RecipientUnreachableError || err instanceof NotImplementedError) {
      throw new UnrecoverableError(error);
    }
    throw err;
  }
}
