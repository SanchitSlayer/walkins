import { UnrecoverableError } from "bullmq";
import { Prisma, prisma } from "@walkins/db";
import {
  ChannelRateLimitedError,
  DeliveryOutcomeUnknownError,
  NotImplementedError,
  type Recipient,
  RecipientUnreachableError,
} from "@walkins/shared";
import type { ChannelResolver } from "../channels/channel-resolver";
import { type AlertJob, alertJobId } from "../queues";
import { type AlertContext, renderAlert } from "./templates";

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

type Loaded = { skip: string } | { recipient: Recipient; context: AlertContext };

async function loadAlert({ driveId, candidateId, templateKey }: AlertJob, now: Date, webUrl: string): Promise<Loaded | null> {
  const [drive, candidate] = await Promise.all([
    prisma.drive.findUnique({ where: { id: driveId }, include: { role: true, company: true } }),
    prisma.candidate.findUnique({ where: { id: candidateId }, include: { user: { select: { phone: true } } } }),
  ]);
  if (!drive || !candidate) return null;
  if (drive.status !== "LIVE") return { skip: `drive is ${drive.status.toLowerCase()}` };
  if (drive.endsAt <= now) return { skip: "drive has ended" };

  let slotStartsAt: string | null = null;
  if (templateKey === "drive_48h") {
    // Targeting leaves applicants out, but only at the moment of fanout; a
    // job queued before they applied is still waiting. Any application,
    // even a withdrawn one, means they have already found this drive.
    const applied = await prisma.application.count({ where: { driveId, candidateId } });
    if (applied > 0) return { skip: "candidate has since applied" };
  } else if (templateKey === "drive_morning_of") {
    const application = await prisma.application.findFirst({
      where: { driveId, candidateId, state: "CONFIRMED" },
      include: { slot: true },
    });
    if (!application) return { skip: "candidate is no longer confirmed" };
    slotStartsAt = application.slot?.startsAt.toISOString() ?? null;
  }

  const [{ distanceMeters }] = await prisma.$queryRaw<{ distanceMeters: number }[]>`
    SELECT ST_Distance(c.geom, d.geom) AS "distanceMeters"
    FROM candidates c, drives d
    WHERE c.id = ${candidateId} AND d.id = ${driveId}
  `;

  return {
    recipient: { candidateId, phone: candidate.user.phone, telegramChatId: candidate.telegramChatId },
    context: {
      roleTitle: drive.role.title,
      companyName: drive.company.name,
      salaryMin: drive.salaryMin,
      salaryMax: drive.salaryMax,
      distanceKm: distanceMeters / 1000,
      venueAddress: drive.venueAddress,
      startsAt: drive.startsAt.toISOString(),
      endsAt: drive.endsAt.toISOString(),
      slotStartsAt,
      driveUrl: `${webUrl}/drives/${driveId}`,
    },
  };
}

// Every attempt leaves a notifications row. The PENDING row inserted before
// the provider call is the claim: the partial unique index lets only one
// PENDING or SENT row exist per alert, so a retry, a redelivered stalled job
// or a duplicate job cannot get past it once a send has started.
export async function processAlert({ data, attemptsMade }: AlertAttempt, deps: ProcessDeps): Promise<string> {
  const { driveId, candidateId, templateKey } = data;
  const now = new Date();
  const row = { driveId, candidateId, templateKey, attempt: attemptsMade + 1, jobId: alertJobId(data) };

  const claimed = await prisma.notification.findFirst({
    where: { driveId, candidateId, templateKey, status: { in: ["PENDING", "SENT"] } },
    select: { id: true },
  });
  if (claimed) return "already sent";

  const loaded = await loadAlert(data, now, deps.webUrl);
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
    const result = await channel.send(loaded.recipient, renderAlert(templateKey, loaded.context, now));
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
