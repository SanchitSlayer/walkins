import { type Application, type ApplicationState, Prisma } from "@prisma/client";

export type Actor = { kind: "system"; userId: null } | { kind: "candidate" | "employer"; userId: string };

type Rule = { from: ApplicationState | null; to: ApplicationState; by: Actor["kind"][] };

// Every legal move an application can make; anything not listed throws.
// `from: null` is creation. Arriving at CHECKED_IN from anywhere other than
// CONFIRMED or NO_SHOW is a walk-in: no slot, no seat taken.
export const APPLICATION_TRANSITIONS: readonly Rule[] = [
  { from: null, to: "CONFIRMED", by: ["candidate"] },
  { from: null, to: "CHECKED_IN", by: ["candidate"] },
  { from: "INTERESTED", to: "CONFIRMED", by: ["candidate"] },
  { from: "INTERESTED", to: "CHECKED_IN", by: ["candidate"] },
  { from: "INTERESTED", to: "WITHDRAWN", by: ["candidate"] },
  { from: "CONFIRMED", to: "WITHDRAWN", by: ["candidate"] },
  { from: "CONFIRMED", to: "CHECKED_IN", by: ["candidate", "employer"] },
  { from: "CONFIRMED", to: "NO_SHOW", by: ["system"] },
  { from: "WITHDRAWN", to: "CONFIRMED", by: ["candidate"] },
  { from: "WITHDRAWN", to: "CHECKED_IN", by: ["candidate"] },
  { from: "NO_SHOW", to: "CHECKED_IN", by: ["employer"] },
  { from: "CHECKED_IN", to: "INTERVIEWED", by: ["employer"] },
  { from: "CHECKED_IN", to: "REJECTED", by: ["employer"] },
  { from: "INTERVIEWED", to: "REJECTED", by: ["employer"] },
  { from: "INTERVIEWED", to: "HIRED", by: ["employer"] },
];

export class IllegalTransitionError extends Error {
  name = "IllegalTransitionError";
}

export class SlotFullError extends Error {
  name = "SlotFullError";
}

// The application changed state between being read and being written, so
// the move was validated against a state it is no longer in.
export class StaleTransitionError extends Error {
  name = "StaleTransitionError";
}

type Tx = Prisma.TransactionClient;

function assertLegal(from: ApplicationState | null, to: ApplicationState, actor: Actor) {
  const rule = APPLICATION_TRANSITIONS.find((r) => r.from === from && r.to === to);
  if (!rule) {
    throw new IllegalTransitionError(`An application can't move from ${from ?? "nothing"} to ${to}`);
  }
  if (!rule.by.includes(actor.kind)) {
    throw new IllegalTransitionError(`A ${actor.kind} can't move an application from ${from ?? "nothing"} to ${to}`);
  }
}

// The WHERE clause is the oversell guard. Under concurrent bookings of the
// last seat, Postgres makes the second UPDATE wait for the first to commit,
// then re-checks bookedCount < capacity against the committed row, so it
// matches nothing instead of taking a seat that is gone.
async function takeSeat(tx: Tx, driveId: string, slotId: string) {
  const taken = await tx.$executeRaw`
    UPDATE drive_slots SET "bookedCount" = "bookedCount" + 1
    WHERE id = ${slotId} AND "driveId" = ${driveId} AND "bookedCount" < capacity
  `;
  if (taken === 0) throw new SlotFullError("That slot has no seats left");
}

async function releaseSeat(tx: Tx, slotId: string) {
  await tx.$executeRaw`
    UPDATE drive_slots SET "bookedCount" = "bookedCount" - 1
    WHERE id = ${slotId} AND "bookedCount" > 0
  `;
}

async function audit(
  tx: Tx,
  application: Pick<Application, "id">,
  actor: Actor,
  before: { state: ApplicationState; slotId: string | null } | null,
  after: { state: ApplicationState; slotId: string | null },
  reason?: string,
) {
  await tx.auditLog.create({
    data: {
      actorUserId: actor.userId,
      entityType: "application",
      entityId: application.id,
      action: `${before?.state ?? "NONE"}->${after.state}`,
      before: before ?? Prisma.DbNull,
      after: { ...after, actor: actor.kind, ...(reason ? { reason } : {}) },
    },
  });
}

// Must run inside the caller's transaction, so the state change, the seat
// and the audit row commit or roll back together. A second application for
// the same drive and candidate fails on the unique constraint (P2002), which
// also rolls back any seat taken here.
export async function createApplication(
  tx: Tx,
  input: { driveId: string; candidateId: string; to: ApplicationState; slotId: string | null; actor: Actor; reason?: string },
): Promise<Application> {
  assertLegal(null, input.to, input.actor);
  const slotId = input.to === "CONFIRMED" ? input.slotId : null;
  if (input.to === "CONFIRMED") {
    if (!slotId) throw new IllegalTransitionError("Confirming needs a slot");
    await takeSeat(tx, input.driveId, slotId);
  }
  const application = await tx.application.create({
    data: { driveId: input.driveId, candidateId: input.candidateId, slotId, state: input.to, stateChangedAt: new Date() },
  });
  await audit(tx, application, input.actor, null, { state: input.to, slotId }, input.reason);
  return application;
}

export async function transitionApplication(
  tx: Tx,
  input: { applicationId: string; to: ApplicationState; actor: Actor; slotId?: string; reason?: string },
): Promise<Application> {
  const current = await tx.application.findUniqueOrThrow({ where: { id: input.applicationId } });
  assertLegal(current.state, input.to, input.actor);

  const walkIn = input.to === "CHECKED_IN" && current.state !== "CONFIRMED" && current.state !== "NO_SHOW";
  let slotId = current.slotId;
  if (input.to === "CONFIRMED") {
    if (!input.slotId) throw new IllegalTransitionError("Confirming needs a slot");
    slotId = input.slotId;
    await takeSeat(tx, current.driveId, slotId);
  } else if (input.to === "WITHDRAWN") {
    if (current.state === "CONFIRMED" && current.slotId) await releaseSeat(tx, current.slotId);
    slotId = null;
  } else if (walkIn) {
    slotId = null;
  }

  // Compare-and-set on the state it was validated against.
  const stateChangedAt = new Date();
  const { count } = await tx.application.updateMany({
    where: { id: current.id, state: current.state },
    data: { state: input.to, slotId, stateChangedAt },
  });
  if (count === 0) throw new StaleTransitionError("This application changed while it was being updated; try again");

  await audit(tx, current, input.actor, { state: current.state, slotId: current.slotId }, { state: input.to, slotId }, input.reason);
  return { ...current, state: input.to, slotId, stateChangedAt };
}
