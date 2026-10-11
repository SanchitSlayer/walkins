import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { type CompanyRole, Prisma, prisma } from "@walkins/db";
import {
  type CompanyInvitation,
  type Handover,
  INVITATION_DAYS,
  type Invite,
  type Membership,
  type MyInvitations,
  type People,
  type UpcomingBooking,
  dayLabel,
  DEFAULT_LOCALE,
  INTL_LOCALE,
  translate,
} from "@walkins/shared";
import { apiError } from "../common/api-error";
import { isUniqueViolation } from "../common/prisma-errors";
import { personRef, requireCompanyAccess } from "../common/require-company";
import { LiveGateway } from "../live/live.gateway";

type Tx = Prisma.TransactionClient;

// Drives still to run. A departing owner's finished drives keep their name
// as history; these need someone answerable.
const OPEN_DRIVE_STATUSES = ["DRAFT", "PENDING", "LIVE"] as const;

const RUNS_DRIVES: CompanyRole[] = ["OWNER", "RECRUITER"];

// Membership changes for one company take turns. Without this, two owners
// removing each other at the same moment would each see the other still
// there and the company would be left with no owner.
async function lockCompany(tx: Tx, companyId: string) {
  await tx.$queryRaw`SELECT id FROM companies WHERE id = ${companyId} FOR UPDATE`;
}

async function requireAnotherOwner(tx: Tx, companyId: string, exceptUserId: string) {
  const others = await tx.user.count({ where: { companyId, companyRole: "OWNER", NOT: { id: exceptUserId } } });
  if (others === 0) throw new BadRequestException(apiError("errors.people.lastOwner"));
}

function auditCompany(tx: Tx, actorUserId: string, companyId: string, action: string, before: object | null, after: object) {
  return tx.auditLog.create({
    data: { actorUserId, entityType: "company", entityId: companyId, action, before: before ?? Prisma.DbNull, after },
  });
}

@Injectable()
export class PeopleService {
  constructor(private readonly live: LiveGateway) {}

  async membership(userId: string): Promise<Membership> {
    const access = await requireCompanyAccess(userId, "read");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });
    return { userId, name: user.name, role: access.role, company: { id: access.companyId, name: access.companyName } };
  }

  async list(userId: string): Promise<People> {
    const { companyId } = await requireCompanyAccess(userId, "read");
    const [members, invitations, owned] = await Promise.all([
      prisma.user.findMany({
        where: { companyId },
        select: { id: true, name: true, phone: true, companyRole: true },
        orderBy: [{ companyRole: "asc" }, { name: "asc" }],
      }),
      prisma.companyInvitation.findMany({
        where: { companyId, acceptedAt: null, revokedAt: null },
        include: { invitedBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.drive.groupBy({ by: ["ownerId"], where: { companyId, status: { in: [...OPEN_DRIVE_STATUSES] } }, _count: true }),
    ]);
    const openDrives = new Map(owned.map((o) => [o.ownerId, o._count]));
    return {
      members: members.map((m) => ({ userId: m.id, name: m.name, phone: m.phone, role: m.companyRole!, openDrives: openDrives.get(m.id) ?? 0 })),
      invitations: invitations.map(toInvitation),
    };
  }

  async invite(userId: string, input: Invite): Promise<CompanyInvitation> {
    const { companyId } = await requireCompanyAccess(userId, "managePeople");
    const member = await prisma.user.findFirst({ where: { phone: input.phone, companyId }, select: { name: true } });
    if (member) throw new ConflictException(apiError("errors.people.alreadyMember", { name: member.name }));

    const now = new Date();
    try {
      return await prisma.$transaction(async (tx) => {
        // An expired invitation still holds the one open place for this
        // phone; a fresh invitation closes it.
        await tx.companyInvitation.updateMany({
          where: { companyId, phone: input.phone, acceptedAt: null, revokedAt: null, expiresAt: { lte: now } },
          data: { revokedAt: now },
        });
        const invitation = await tx.companyInvitation.create({
          data: {
            companyId,
            phone: input.phone,
            name: input.name,
            role: input.role,
            invitedById: userId,
            expiresAt: new Date(now.getTime() + INVITATION_DAYS * 86_400_000),
          },
          include: { invitedBy: { select: { name: true } } },
        });
        await auditCompany(tx, userId, companyId, "invited", null, { invitationId: invitation.id, phone: input.phone, role: input.role });
        return toInvitation(invitation);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException(apiError("errors.people.alreadyInvited", { phone: input.phone }));
      throw err;
    }
  }

  async revoke(userId: string, invitationId: string): Promise<void> {
    const { companyId } = await requireCompanyAccess(userId, "managePeople");
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.companyInvitation.updateMany({
        where: { id: invitationId, companyId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date(), revokedById: userId },
      });
      if (count === 0) throw new NotFoundException(apiError("errors.people.invitationGone"));
      await auditCompany(tx, userId, companyId, "invitation_revoked", null, { invitationId });
    });
  }

  async changeRole(userId: string, targetId: string, role: CompanyRole, successorId?: string): Promise<Handover> {
    const { companyId } = await requireCompanyAccess(userId, "managePeople");
    return prisma.$transaction(async (tx) => {
      await lockCompany(tx, companyId);
      const target = await tx.user.findFirst({ where: { id: targetId, companyId } });
      if (!target?.companyRole) throw new NotFoundException(apiError("errors.people.notMember"));
      if (target.companyRole === role) return { drivesReassigned: 0, successor: null };
      if (target.companyRole === "OWNER") await requireAnotherOwner(tx, companyId, targetId);
      // A viewer can't run a drive, so can't be answerable for one.
      const handover = RUNS_DRIVES.includes(role)
        ? { drivesReassigned: 0, successor: null }
        : await handOver(tx, companyId, targetId, successorId ?? (userId === targetId ? null : userId), userId);
      await tx.user.update({ where: { id: targetId }, data: { companyRole: role } });
      await auditCompany(tx, userId, companyId, "role_changed", { userId: targetId, role: target.companyRole }, { userId: targetId, role, ...handover });
      return handover;
    });
  }

  // Removing someone, or leaving. The user stays: their name is on the audit
  // trail, on shortlists and on drives they ran, all of which stay as they
  // were. Their open drives move to a successor, invitations they sent are
  // closed, and they become a candidate again.
  async remove(userId: string, targetId: string, successorId?: string): Promise<Handover> {
    const leaving = userId === targetId;
    const { companyId } = await requireCompanyAccess(userId, leaving ? "read" : "managePeople");
    const handover = await prisma.$transaction(async (tx) => {
      await lockCompany(tx, companyId);
      const target = await tx.user.findFirst({ where: { id: targetId, companyId } });
      if (!target?.companyRole) throw new NotFoundException(apiError("errors.people.notMember"));
      if (target.companyRole === "OWNER") await requireAnotherOwner(tx, companyId, targetId);
      const handover = await handOver(tx, companyId, targetId, successorId ?? (leaving ? null : userId), userId);
      await tx.companyInvitation.updateMany({
        where: { companyId, invitedById: targetId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.user.update({ where: { id: targetId }, data: { companyId: null, companyRole: null, role: "CANDIDATE" } });
      await auditCompany(tx, userId, companyId, leaving ? "member_left" : "member_removed", { userId: targetId, role: target.companyRole }, { userId: targetId, ...handover });
      return handover;
    });
    // The desk view carries candidates' names; an open board shouldn't
    // outlive the person's place in the company.
    this.live.evict(targetId);
    return handover;
  }

  async mine(userId: string): Promise<MyInvitations> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { phone: true } });
    const [invitations, bookings] = await Promise.all([
      prisma.companyInvitation.findMany({
        where: { phone: user.phone, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        include: { company: { select: { name: true, city: { select: { name: true } } } }, invitedBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      upcomingBookings(prisma, userId),
    ]);
    return {
      invitations: invitations.map((i) => ({
        id: i.id,
        companyName: i.company.name,
        cityName: i.company.city.name,
        role: i.role,
        invitedBy: i.invitedBy.name,
        expiresAt: i.expiresAt.toISOString(),
      })),
      bookings,
    };
  }

  async accept(userId: string, invitationId: string): Promise<Membership> {
    return prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { company: { select: { name: true } } } });
      if (user.role === "ADMIN") throw new ConflictException(apiError("errors.invitation.adminAccount"));
      if (user.company) throw new ConflictException(apiError("errors.invitation.alreadyInCompany", { company: user.company.name }));

      // Turning up to find your seat gone is the harm this platform exists
      // to prevent, so a booked interview still ahead blocks joining, by name.
      const bookings = await upcomingBookings(tx, userId);
      if (bookings.length > 0) {
        const named = new Intl.ListFormat(INTL_LOCALE[DEFAULT_LOCALE], { type: "conjunction" }).format(
          bookings.map((b) =>
            translate(DEFAULT_LOCALE, "errors.invitation.booking", { role: b.roleTitle, company: b.companyName, day: dayLabel(new Date(b.startsAt), new Date()) }),
          ),
        );
        throw new ConflictException(apiError("errors.invitation.upcomingBookings", { count: bookings.length, bookings: named }, { bookings }));
      }

      const now = new Date();
      const invitation = await tx.companyInvitation.findFirst({
        where: { id: invitationId, phone: user.phone },
        include: { company: { select: { id: true, name: true } } },
      });
      // One conditional write: of two taps, or a tap racing a revoke, only
      // one can find the invitation still open.
      const { count } = await tx.companyInvitation.updateMany({
        where: { id: invitationId, phone: user.phone, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { acceptedAt: now, acceptedById: userId },
      });
      if (!invitation || count === 0) throw new NotFoundException(apiError("errors.invitation.gone"));

      // Accepting two companies' invitations at once: the second finds a
      // company already set.
      const name = user.name === user.phone ? invitation.name : user.name;
      const joined = await tx.user.updateMany({
        where: { id: userId, companyId: null },
        data: { companyId: invitation.companyId, companyRole: invitation.role, role: "EMPLOYER", name },
      });
      if (joined.count === 0) throw new ConflictException(apiError("errors.invitation.alreadyInCompany", { company: invitation.company.name }));
      await auditCompany(tx, userId, invitation.companyId, "member_joined", null, { userId, role: invitation.role, invitationId });
      return { userId, name, role: invitation.role, company: invitation.company };
    });
  }
}

function toInvitation(i: {
  id: string;
  phone: string;
  name: string;
  role: CompanyRole;
  createdAt: Date;
  expiresAt: Date;
  invitedBy: { name: string };
}): CompanyInvitation {
  return {
    id: i.id,
    phone: i.phone,
    name: i.name,
    role: i.role,
    invitedBy: i.invitedBy.name,
    createdAt: i.createdAt.toISOString(),
    expiresAt: i.expiresAt.toISOString(),
  };
}

async function upcomingBookings(db: Tx, userId: string): Promise<UpcomingBooking[]> {
  const rows = await db.application.findMany({
    where: { state: "CONFIRMED", candidate: { userId }, drive: { endsAt: { gt: new Date() } } },
    select: { slot: { select: { startsAt: true } }, drive: { select: { startsAt: true, role: { select: { title: true } }, company: { select: { name: true } } } } },
    orderBy: { drive: { startsAt: "asc" } },
  });
  return rows.map((r) => ({
    roleTitle: r.drive.role.title,
    companyName: r.drive.company.name,
    startsAt: (r.slot?.startsAt ?? r.drive.startsAt).toISOString(),
  }));
}

// Moves a person's open drives to a successor who can run them: the one
// asked for, else the given default, else the company's longest-standing
// other owner. Each move is audited like any other change of owner.
async function handOver(tx: Tx, companyId: string, fromId: string, successorId: string | null, actorId: string): Promise<Handover> {
  const open = await tx.drive.findMany({
    where: { companyId, ownerId: fromId, status: { in: [...OPEN_DRIVE_STATUSES] } },
    select: { id: true },
  });
  if (open.length === 0) return { drivesReassigned: 0, successor: null };

  const eligible = { companyId, companyRole: { in: RUNS_DRIVES }, NOT: { id: fromId } };
  const successor = successorId
    ? await tx.user.findFirst({ where: { ...eligible, id: successorId } })
    : await tx.user.findFirst({ where: { ...eligible, companyRole: "OWNER" }, orderBy: { createdAt: "asc" } });
  if (!successor) throw new BadRequestException(apiError("errors.people.notARecruiter"));

  await tx.drive.updateMany({ where: { id: { in: open.map((d) => d.id) } }, data: { ownerId: successor.id } });
  await tx.auditLog.createMany({
    data: open.map((d) => ({
      actorUserId: actorId,
      entityType: "drive",
      entityId: d.id,
      action: "owner_changed",
      before: { ownerId: fromId },
      after: { ownerId: successor.id },
    })),
  });
  return { drivesReassigned: open.length, successor: personRef(successor, companyId) };
}
