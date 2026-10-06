import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Actor, balanceOf, companyBalance, createApplication, ledgerAccount, PLATFORM_ACCOUNT, prisma, transitionApplication } from "@walkins/db";
import type { AlertService } from "../src/alerts/alert-service";
import { processCharge } from "../src/charge/process-charge";
import { type MaintenanceDeps, runMaintenance, sweepCharges } from "../src/maintenance/maintenance-jobs";

// Real rows in the test database (test/setup.ts): a charge is a ledger write,
// and ledger rows can never be removed.
const PRICE = 200_00;
const ids = { company: "", drive: "", slot: "", users: [] as string[], candidates: [] as string[] };
const employer: Actor = { kind: "employer", userId: "" };

let seq = 0;
async function showUp(opts: { isValid?: boolean; scannedAt?: Date; hire?: boolean } = {}) {
  const user = await prisma.user.create({
    data: { phone: `6${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`, name: `Charging Test ${seq++}`, role: "CANDIDATE" },
  });
  const city = await prisma.city.findFirstOrThrow({ where: { name: "Bengaluru" } });
  const candidate = await prisma.candidate.create({
    data: { userId: user.id, cityId: city.id, homeLat: city.centerLat, homeLng: city.centerLng, maxTravelKm: 10, experienceYears: 1 },
  });
  ids.users.push(user.id);
  ids.candidates.push(candidate.id);
  return prisma.$transaction(async (tx) => {
    const app = await createApplication(tx, {
      driveId: ids.drive,
      candidateId: candidate.id,
      to: "CONFIRMED",
      slotId: ids.slot,
      actor: { kind: "candidate", userId: user.id },
    });
    await transitionApplication(tx, { applicationId: app.id, to: "CHECKED_IN", actor: { kind: "candidate", userId: user.id } });
    if (opts.hire) {
      await transitionApplication(tx, { applicationId: app.id, to: "INTERVIEWED", actor: employer });
      await transitionApplication(tx, { applicationId: app.id, to: "HIRED", actor: employer });
    }
    return tx.checkIn.create({
      data: { applicationId: app.id, method: "SCAN", isValid: opts.isValid ?? true, scannedAt: opts.scannedAt ?? new Date(), flagReason: opts.isValid === false ? "test flag" : null },
    });
  });
}

const charged = (checkInId: string) => prisma.ledgerEntry.count({ where: { txnId: `charge:checkin:${checkInId}` } });

beforeAll(async () => {
  const city = await prisma.city.findFirstOrThrow({ where: { name: "Bengaluru" } });
  const role = await prisma.role.findFirstOrThrow();
  const company = await prisma.company.create({
    data: { name: "Charging Test Company", contactPhone: "9000000777", cityId: city.id, verificationStatus: "VERIFIED" },
  });
  const user = await prisma.user.create({
    data: { phone: `5${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`, name: "Charging Test Employer", role: "EMPLOYER", companyId: company.id },
  });
  employer.userId = user.id;
  ids.users.push(user.id);
  const now = Date.now();
  const drive = await prisma.drive.create({
    data: {
      companyId: company.id,
      roleId: role.id,
      cityId: city.id,
      salaryMin: 15000,
      salaryMax: 20000,
      venueAddress: "Charging Test Venue",
      venueLat: city.centerLat,
      venueLng: city.centerLng,
      startsAt: new Date(now - 3600_000),
      endsAt: new Date(now + 3600_000),
      capacity: 20,
      experienceMin: 0,
      experienceMax: 5,
      status: "LIVE",
      slots: { create: [{ startsAt: new Date(now + 1800_000), capacity: 20 }] },
    },
    include: { slots: true },
  });
  Object.assign(ids, { company: company.id, drive: drive.id, slot: drive.slots[0].id });
});

afterAll(async () => {
  const applications = await prisma.application.findMany({ where: { driveId: ids.drive }, select: { id: true } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: applications.map((a) => a.id) } } });
  await prisma.checkIn.deleteMany({ where: { application: { driveId: ids.drive } } });
  await prisma.application.deleteMany({ where: { driveId: ids.drive } });
  await prisma.driveSlot.deleteMany({ where: { driveId: ids.drive } });
  await prisma.drive.delete({ where: { id: ids.drive } });
  await prisma.candidate.deleteMany({ where: { id: { in: ids.candidates } } });
  await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
  await prisma.company.delete({ where: { id: ids.company } });
  await prisma.$disconnect();
});

describe("charging a verified check-in", () => {
  it("debits the company and credits revenue at the price in effect, letting the wallet go negative", async () => {
    const revenue = await ledgerAccount(prisma, "PLATFORM", PLATFORM_ACCOUNT.revenue);
    const [walletBefore, revenueBefore] = [await companyBalance(prisma, ids.company), await balanceOf(prisma, revenue)];
    const checkIn = await showUp();

    await expect(processCharge({ data: { checkInId: checkIn.id } })).resolves.toBe("charged ₹200");

    expect(await companyBalance(prisma, ids.company)).toBe(walletBefore - PRICE);
    expect(walletBefore - PRICE).toBeLessThan(0);
    expect(await balanceOf(prisma, revenue)).toBe(revenueBefore + PRICE);
    const legs = await prisma.ledgerEntry.findMany({ where: { txnId: `charge:checkin:${checkIn.id}` } });
    expect(legs.map((l) => [l.direction, l.amountPaise, l.reason, l.refType, l.refId]).sort()).toEqual([
      ["CREDIT", PRICE, "CHECK_IN_CHARGE", "check_in", checkIn.id],
      ["DEBIT", PRICE, "CHECK_IN_CHARGE", "check_in", checkIn.id],
    ]);
  });

  it("charges once, whether the job runs again or two runs race", async () => {
    const checkIn = await showUp();
    const results = await Promise.all([processCharge({ data: { checkInId: checkIn.id } }), processCharge({ data: { checkInId: checkIn.id } })]);
    expect(results.sort()).toEqual(["already charged", "charged ₹200"]);
    await expect(processCharge({ data: { checkInId: checkIn.id } })).resolves.toBe("already charged");
    expect(await charged(checkIn.id)).toBe(2);
  });

  it("doesn't charge a flagged check-in, and charges it once confirmed", async () => {
    const checkIn = await showUp({ isValid: false });
    await expect(processCharge({ data: { checkInId: checkIn.id } })).resolves.toBe("not charged: waiting for the employer to confirm it");
    expect(await charged(checkIn.id)).toBe(0);

    await prisma.checkIn.update({ where: { id: checkIn.id }, data: { isValid: true } });
    await expect(processCharge({ data: { checkInId: checkIn.id } })).resolves.toBe("charged ₹200");
  });

  it("never charges a check-in from before billing began", async () => {
    const checkIn = await showUp({ scannedAt: new Date("2024-01-01T10:00:00Z") });
    await expect(processCharge({ data: { checkInId: checkIn.id } })).resolves.toBe("not charged: the check-in predates billing");
    expect(await charged(checkIn.id)).toBe(0);
  });
});

describe("the charge sweep", () => {
  it("queues exactly the verified check-ins since billing began that have no charge", async () => {
    const missed = await showUp();
    const flagged = await showUp({ isValid: false });
    const old = await showUp({ scannedAt: new Date("2024-01-01T10:00:00Z") });
    const done = await showUp();
    await processCharge({ data: { checkInId: done.id } });
    const charge = vi.fn(async () => {});

    await sweepCharges(charge, [ids.drive]);

    const queued = charge.mock.calls.map(([job]) => (job as { checkInId: string }).checkInId);
    expect(queued).toContain(missed.id);
    expect(queued).not.toContain(flagged.id);
    expect(queued).not.toContain(old.id);
    expect(queued).not.toContain(done.id);
  });
});

describe("employer analytics", () => {
  it("counts confirmed from the audit log, so a hired candidate still counts as having booked", async () => {
    await showUp({ hire: true });
    const deps = { markAnalyticsRefreshed: vi.fn(async () => {}), alerts: {} as AlertService } as unknown as MaintenanceDeps;

    await expect(runMaintenance("refresh-analytics", deps)).resolves.toBe("analytics refreshed");

    const [funnel] = await prisma.$queryRaw<{ confirmed: number; checkedIn: number; hired: number; walkIns: number }[]>`
      SELECT confirmed, "checkedIn", hired, "walkIns" FROM drive_funnel WHERE "driveId" = ${ids.drive}
    `;
    const states = await prisma.application.groupBy({ by: ["state"], where: { driveId: ids.drive }, _count: true });
    const everyone = states.reduce((n, s) => n + s._count, 0);
    expect(states.find((s) => s.state === "CONFIRMED")).toBeUndefined();
    expect(funnel).toMatchObject({ confirmed: everyone, hired: 1, walkIns: 0 });
    expect(deps.markAnalyticsRefreshed).toHaveBeenCalledOnce();
  });
});
