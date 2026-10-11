import { ForbiddenException, type HttpException } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@walkins/db";
import { COMPANY_PERMISSIONS, type CompanyPermission, type CompanyRole, companyCan } from "@walkins/shared";
import { ApplicantsService } from "../src/applications/applicants.service";
import { ApplicationsService } from "../src/applications/applications.service";
import { BillingService } from "../src/billing/billing.service";
import { MockGateway } from "../src/billing/mock-gateway";
import { CheckInTokenService } from "../src/check-in/check-in-token.service";
import { CheckInService } from "../src/check-in/check-in.service";
import type { JobsService } from "../src/common/jobs.service";
import { RateLimiterService } from "../src/common/rate-limiter.service";
import type { StorageService } from "../src/common/storage.service";
import { CompaniesService } from "../src/companies/companies.service";
import { PeopleService } from "../src/companies/people.service";
import { DrivesService } from "../src/drives/drives.service";
import type { GeocodingService } from "../src/drives/geocoding.service";
import { LiveBoardService } from "../src/live/live-board.service";
import type { LiveGateway } from "../src/live/live.gateway";
import { addPerson, createFixture, type Fixture, removeFixture } from "./fixtures";

const live = { publish: vi.fn(async () => {}), evict: vi.fn() } as unknown as LiveGateway;
const jobs = { alert: vi.fn(async () => {}), reembed: vi.fn(async () => {}), charge: vi.fn(async () => {}) } as unknown as JobsService;
const drives = new DrivesService({} as GeocodingService, jobs);
const applications = new ApplicationsService(live);
const applicants = new ApplicantsService({} as StorageService, jobs, live);
const checkIns = new CheckInService(new CheckInTokenService(), live, new RateLimiterService(), jobs);
const billing = new BillingService(new MockGateway());
const companies = new CompaniesService();
const people = new PeopleService(live);
const board = new LiveBoardService();

const MISSING = "missing-id";

let fixture: Fixture;
let candidate = 0;

function nextCandidate() {
  return fixture.candidates[candidate++];
}

function code(err: unknown): string | undefined {
  return ((err as HttpException).getResponse?.() as { code?: string } | undefined)?.code;
}

async function refusal(call: Promise<unknown>): Promise<string | null> {
  return call.then(
    () => null,
    (err) => (err instanceof ForbiddenException ? (code(err) ?? "forbidden") : null),
  );
}

beforeAll(async () => {
  fixture = await createFixture("People Test", 8);
});

beforeEach(() => vi.mocked(live.evict).mockClear());

afterAll(async () => {
  await removeFixture(fixture);
});

// Every employer service method, with the permission it should need. The
// arguments point at nothing, so an allowed call fails as not found (or does
// nothing) rather than changing anything; only a refusal is a 403.
const EMPLOYER_CALLS: [string, CompanyPermission, (userId: string) => Promise<unknown>][] = [
  ["list drives", "read", (u) => drives.listMine(u, undefined, 5)],
  ["open a drive", "read", (u) => drives.findOne(u, MISSING)],
  ["create a drive", "runDrives", (u) => drives.create(u, { startsAt: new Date(), endsAt: new Date() } as never)],
  ["edit a drive", "runDrives", (u) => drives.update(u, MISSING, {})],
  ["pin a venue", "runDrives", (u) => drives.pinVenue(u, MISSING, { lat: 0, lng: 0, accuracy: 10 })],
  ["submit a drive", "runDrives", (u) => drives.submit(u, MISSING)],
  ["cancel a drive", "runDrives", (u) => drives.remove(u, MISSING)],
  ["reassign a drive", "managePeople", (u) => drives.reassign(u, MISSING, MISSING)],
  ["list applicants", "read", (u) => applicants.list(u, MISSING, 0.5)],
  ["play an intro", "read", (u) => applicants.introAudio(u, MISSING)],
  ["shortlist", "runDrives", (u) => applicants.act(u, MISSING, { applicationIds: [MISSING], action: "shortlist" })],
  ["move an application", "runDrives", (u) => applications.updateByEmployer(u, MISSING, { to: "INTERVIEWED" })],
  ["show the check-in code", "runDrives", (u) => checkIns.issueCode(u, MISSING)],
  ["mark someone present", "runDrives", (u) => checkIns.markPresent(u, MISSING)],
  ["confirm a flagged check-in", "runDrives", (u) => checkIns.confirmFlagged(u, MISSING)],
  ["see the wallet", "read", (u) => billing.wallet(u)],
  ["start a top-up", "manageBilling", (u) => billing.topUpStatus(u, MISSING)],
  ["confirm a top-up", "manageBilling", (u) => billing.confirmTopUp(u, MISSING, { gatewayPaymentId: MISSING, signature: MISSING })],
  ["pay at the mock checkout", "manageBilling", (u) => billing.mockCheckout(u, MISSING, "success")],
  ["see settings", "read", (u) => companies.settings(u)],
  ["see analytics", "read", (u) => companies.analytics(u)],
  ["change settings", "manageCompany", (u) => companies.updateSettings(u, { readsLanguages: ["en", "hi"] })],
  ["see the team", "read", (u) => people.list(u)],
  ["revoke an invitation", "managePeople", (u) => people.revoke(u, MISSING)],
  ["change a role", "managePeople", (u) => people.changeRole(u, MISSING, "VIEWER")],
  ["remove someone", "managePeople", (u) => people.remove(u, MISSING)],
];

describe("what each company role may do", () => {
  it("covers every permission in the table", () => {
    expect(new Set(EMPLOYER_CALLS.map(([, permission]) => permission))).toEqual(new Set(Object.keys(COMPANY_PERMISSIONS)));
  });

  for (const role of ["OWNER", "RECRUITER", "VIEWER"] as CompanyRole[]) {
    it(`lets a ${role.toLowerCase()} do exactly what COMPANY_PERMISSIONS allows`, async () => {
      const person = role === "OWNER" ? fixture.employer : await addPerson(fixture, `People Test ${role}`, role);
      for (const [action, permission, call] of EMPLOYER_CALLS) {
        const refused = await refusal(call(person.id));
        expect({ action, refused }).toEqual({
          action,
          refused: companyCan(role, permission) ? null : `errors.people.cannot.${permission}`,
        });
      }
    });
  }

  it("refuses everything to someone in no company", async () => {
    const outsider = await addPerson(fixture, "People Test Outsider", null);
    for (const [action, , call] of EMPLOYER_CALLS) {
      expect({ action, refused: await refusal(call(outsider.id)) }).toEqual({ action, refused: "errors.auth.noCompany" });
    }
  });
});

describe("invitations", () => {
  it("lets the invitee see the company, join with one tap, and take the invited name", async () => {
    const invitee = await addPerson(fixture, "placeholder", null);
    await prisma.user.update({ where: { id: invitee.id }, data: { name: invitee.phone } });

    const sent = await people.invite(fixture.employer.id, { phone: invitee.phone, name: "Priya Recruiter", role: "RECRUITER" });
    const { invitations, bookings } = await people.mine(invitee.id);
    expect(bookings).toEqual([]);
    expect(invitations).toEqual([expect.objectContaining({ id: sent.id, companyName: fixture.company.name, role: "RECRUITER", invitedBy: fixture.employer.name })]);

    const membership = await people.accept(invitee.id, sent.id);
    expect(membership).toMatchObject({ name: "Priya Recruiter", role: "RECRUITER", company: { id: fixture.company.id } });
    const joined = await prisma.user.findUniqueOrThrow({ where: { id: invitee.id } });
    expect(joined).toMatchObject({ role: "EMPLOYER", companyId: fixture.company.id, companyRole: "RECRUITER", name: "Priya Recruiter" });
    expect((await people.mine(invitee.id)).invitations).toEqual([]);
  });

  it("can't be used twice, even by two taps at once", async () => {
    const invitee = await addPerson(fixture, "People Test Double Tap", null);
    const sent = await people.invite(fixture.employer.id, { phone: invitee.phone, name: "Double Tap", role: "VIEWER" });

    const results = await Promise.allSettled([people.accept(invitee.id, sent.id), people.accept(invitee.id, sent.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: fixture.company.id, action: "member_joined", after: { path: ["invitationId"], equals: sent.id } } })).toBe(1);
  });

  it("joins only one company when two invitations are accepted at once", async () => {
    const elsewhere = await addPerson(fixture, "People Test Elsewhere", "OWNER", true);
    const invitee = await addPerson(fixture, "People Test Two Offers", null);
    const ours = await people.invite(fixture.employer.id, { phone: invitee.phone, name: "Two Offers", role: "RECRUITER" });
    const theirs = await people.invite(elsewhere.id, { phone: invitee.phone, name: "Two Offers", role: "RECRUITER" });

    const results = await Promise.allSettled([people.accept(invitee.id, ours.id), people.accept(invitee.id, theirs.id)]);
    const won = results.flatMap((r) => (r.status === "fulfilled" ? [r.value.company.id] : []));
    expect(won).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: invitee.id } })).companyId).toBe(won[0]);
  });

  it("can't be accepted once revoked or expired, and can be sent again after expiry", async () => {
    const invitee = await addPerson(fixture, "People Test Revoked", null);
    const revoked = await people.invite(fixture.employer.id, { phone: invitee.phone, name: "Revoked", role: "VIEWER" });
    await people.revoke(fixture.employer.id, revoked.id);
    await expect(people.accept(invitee.id, revoked.id)).rejects.toSatisfy((err) => code(err) === "errors.invitation.gone");

    const expired = await people.invite(fixture.employer.id, { phone: invitee.phone, name: "Expired", role: "VIEWER" });
    await expect(people.invite(fixture.employer.id, { phone: invitee.phone, name: "Again", role: "VIEWER" })).rejects.toSatisfy(
      (err) => code(err) === "errors.people.alreadyInvited",
    );
    await prisma.companyInvitation.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(people.accept(invitee.id, expired.id)).rejects.toSatisfy((err) => code(err) === "errors.invitation.gone");

    const fresh = await people.invite(fixture.employer.id, { phone: invitee.phone, name: "Fresh", role: "VIEWER" });
    await expect(people.accept(invitee.id, fresh.id)).resolves.toMatchObject({ role: "VIEWER" });
  });

  it("isn't sent to someone already in the company", async () => {
    await expect(people.invite(fixture.employer.id, { phone: fixture.employer.phone, name: "Me", role: "VIEWER" })).rejects.toSatisfy(
      (err) => code(err) === "errors.people.alreadyMember",
    );
  });

  it("waits while the invitee has a booked interview ahead, naming it, and joins once it's released", async () => {
    const { userId } = nextCandidate();
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const booked = await applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, {});
    const sent = await people.invite(fixture.employer.id, { phone: user.phone, name: "Booked Candidate", role: "RECRUITER" });

    expect((await people.mine(userId)).bookings).toEqual([expect.objectContaining({ companyName: fixture.company.name })]);
    const refused = await people.accept(userId, sent.id).catch((err: HttpException) => err);
    expect(code(refused)).toBe("errors.invitation.upcomingBookings");
    const body = (refused as HttpException).getResponse() as { message: string; bookings: unknown[] };
    expect(body.message).toContain(fixture.company.name);
    expect(body.bookings).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).role).toBe("CANDIDATE");

    await applications.release(userId, booked.id);
    await expect(people.accept(userId, sent.id)).resolves.toMatchObject({ role: "RECRUITER" });
  });
});

describe("removing someone", () => {
  it("hands their open drives on, keeps their shortlist and audit trail, and shuts them out at once", async () => {
    const recruiter = await addPerson(fixture, "People Test Leaver", "RECRUITER");
    await drives.reassign(fixture.employer.id, fixture.drive.id, recruiter.id);
    const { userId } = nextCandidate();
    const application = await applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, {});
    await applicants.act(recruiter.id, fixture.drive.id, { applicationIds: [application.id], action: "shortlist" });

    const handover = await people.remove(fixture.employer.id, recruiter.id);

    expect(handover).toEqual({ drivesReassigned: 1, successor: { userId: fixture.employer.id, name: fixture.employer.name, current: true } });
    expect((await prisma.drive.findUniqueOrThrow({ where: { id: fixture.drive.id } })).ownerId).toBe(fixture.employer.id);
    expect(await prisma.auditLog.count({ where: { entityId: application.id, action: "shortlisted", actorUserId: recruiter.id } })).toBe(1);
    const listed = (await applicants.list(fixture.employer.id, fixture.drive.id, 0.5)).applicants.find((a) => a.applicationId === application.id);
    expect(listed?.shortlistedBy).toEqual({ userId: recruiter.id, name: recruiter.name, current: false });

    expect(await prisma.user.findUniqueOrThrow({ where: { id: recruiter.id } })).toMatchObject({ role: "CANDIDATE", companyId: null, companyRole: null });
    // Their access token still says EMPLOYER at this company for up to 15
    // minutes; the service reads the database, not the token.
    expect(await refusal(drives.listMine(recruiter.id, undefined, 5))).toBe("errors.auth.noCompany");
    expect(await board.canWatch(recruiter.id, fixture.drive.id)).toBe(false);
    expect(live.evict).toHaveBeenCalledWith(recruiter.id);
  });

  it("closes the invitations a departing owner sent", async () => {
    const owner = await addPerson(fixture, "People Test Second Owner", "OWNER");
    const invitee = await addPerson(fixture, "People Test Orphaned Invite", null);
    const sent = await people.invite(owner.id, { phone: invitee.phone, name: "Orphan", role: "VIEWER" });

    await people.remove(fixture.employer.id, owner.id);

    expect((await prisma.companyInvitation.findUniqueOrThrow({ where: { id: sent.id } })).revokedAt).not.toBeNull();
    expect((await people.mine(invitee.id)).invitations).toEqual([]);
  });

  it("hands drives on when a recruiter becomes a viewer", async () => {
    const recruiter = await addPerson(fixture, "People Test Demoted", "RECRUITER");
    await drives.reassign(fixture.employer.id, fixture.drive.id, recruiter.id);

    const handover = await people.changeRole(fixture.employer.id, recruiter.id, "VIEWER");

    expect(handover.drivesReassigned).toBe(1);
    expect((await prisma.drive.findUniqueOrThrow({ where: { id: fixture.drive.id } })).ownerId).toBe(fixture.employer.id);
    await expect(drives.reassign(fixture.employer.id, fixture.drive.id, recruiter.id)).rejects.toSatisfy(
      (err) => code(err) === "errors.people.notARecruiter",
    );
  });

  it("never leaves a company without an owner, even when two owners remove each other at once", async () => {
    const owner = await addPerson(fixture, "People Test Lone Owner", "OWNER", true);
    await expect(people.remove(owner.id, owner.id)).rejects.toSatisfy((err) => code(err) === "errors.people.lastOwner");
    await expect(people.changeRole(owner.id, owner.id, "RECRUITER")).rejects.toSatisfy((err) => code(err) === "errors.people.lastOwner");

    const second = await prisma.user.create({
      data: { phone: `7${Date.now().toString().slice(-9)}`, name: "People Test Co-owner", role: "EMPLOYER", companyId: owner.companyId, companyRole: "OWNER" },
    });
    fixture.extraUserIds.push(second.id);
    const results = await Promise.allSettled([people.remove(owner.id, second.id), people.remove(second.id, owner.id)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.user.count({ where: { companyId: owner.companyId, companyRole: "OWNER" } })).toBe(1);
  });
});

describe("who did what at the desk", () => {
  it("names the recruiter who marked someone present", async () => {
    const recruiter = await addPerson(fixture, "People Test Desk", "RECRUITER");
    const { userId } = nextCandidate();
    const application = await applications.apply(userId, fixture.drive.id, fixture.roomySlot.id, {});

    await checkIns.markPresent(recruiter.id, application.id, "no phone signal");

    const arrival = (await board.snapshot(fixture.drive.id)).arrivals.find((a) => a.applicationId === application.id);
    expect(arrival?.recordedBy).toEqual({ userId: recruiter.id, name: recruiter.name, current: true });
    expect(arrival?.confirmedBy).toBeNull();
  });

  it("records who created and changed a drive", async () => {
    const recruiter = await addPerson(fixture, "People Test Editor", "RECRUITER");
    await drives.reassign(fixture.employer.id, fixture.drive.id, recruiter.id);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: fixture.drive.id, action: "owner_changed" }, orderBy: { createdAt: "desc" } });
    expect(audit).toMatchObject({ actorUserId: fixture.employer.id, after: { ownerId: recruiter.id } });
    expect((await drives.findOne(recruiter.id, fixture.drive.id)).owner).toEqual({ userId: recruiter.id, name: recruiter.name, current: true });
  });
});
