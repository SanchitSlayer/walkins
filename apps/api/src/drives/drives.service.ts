import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, prisma } from "@walkins/db";
import {
  type CreateDriveInput,
  type DriveSearchPage,
  type DriveSearchQuery,
  type DriveSearchResult,
  type PublicDriveDetail,
  type UpdateDriveInput,
  type VenuePinInput,
  driveSearchPageSchema,
  haversineDistanceKm,
  knockoutQuestionsSchema,
  MAX_TRAVEL_KM,
  publicKnockoutQuestions,
  publicDriveDetailSchema,
  formatDistance,
  formatTime,
  CHECK_IN_OPENS_BEFORE_START_MS,
  DEFAULT_LOCALE,
  INTL_LOCALE,
  type RescheduleDriveInput,
} from "@walkins/shared";
import { JobsService } from "../common/jobs.service";
import { GeocodingService } from "./geocoding.service";
import { apiError } from "../common/api-error";
import { PERSON_SELECT, personRef, requireCompanyAccess, requireNotSuspended } from "../common/require-company";

type RawSearchRow = {
  id: string;
  roleId: string;
  cityId: string;
  salaryMin: number;
  salaryMax: number;
  venueAddress: string;
  venueLat: number;
  venueLng: number;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  experienceMin: number;
  experienceMax: number;
  status: DriveSearchResult["status"];
  needsManualGeocode: boolean;
  roleTitle: string;
  roleSlug: string;
  cityName: string;
  cityState: string;
  distanceMeters: number;
  bookedCount: number;
};

// Shared by search and the public detail endpoint. bookedCount is summed in
// the same statement (not by loading slots into JS) so search stays a single
// round trip however many results it returns; ::int because SUM over an
// integer column is bigint, which Prisma returns as a BigInt that JSON
// serialisation rejects.
function publicDriveColumns(origin: { lat: number; lng: number }) {
  return Prisma.sql`
    d.id, d."roleId", d."cityId", d."salaryMin", d."salaryMax", d."venueAddress",
    d."venueLat", d."venueLng", d."startsAt", d."endsAt", d.capacity,
    d."experienceMin", d."experienceMax", d.status, d."needsManualGeocode",
    r.title AS "roleTitle", r.slug AS "roleSlug",
    c.name AS "cityName", c.state AS "cityState",
    ST_Distance(d.geom, ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography) AS "distanceMeters",
    (SELECT COALESCE(SUM(s."bookedCount"), 0)::int FROM drive_slots s WHERE s."driveId" = d.id) AS "bookedCount"
  `;
}

function toSearchResult(row: RawSearchRow): DriveSearchResult {
  return {
    id: row.id,
    roleId: row.roleId,
    cityId: row.cityId,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    venueAddress: row.venueAddress,
    venueLat: row.venueLat,
    venueLng: row.venueLng,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    capacity: row.capacity,
    experienceMin: row.experienceMin,
    experienceMax: row.experienceMax,
    status: row.status,
    needsManualGeocode: row.needsManualGeocode,
    role: { title: row.roleTitle, slug: row.roleSlug },
    city: { name: row.cityName, state: row.cityState },
    distanceKm: row.distanceMeters / 1000,
    bookedCount: row.bookedCount,
  };
}

function encodeCursor(row: RawSearchRow): string {
  return Buffer.from(`${row.distanceMeters}:${row.id}`).toString("base64url");
}

function decodeCursor(cursor: string): { distanceMeters: number; id: string } {
  const [distanceMeters, id] = Buffer.from(cursor, "base64url").toString("utf8").split(":");
  return { distanceMeters: Number(distanceMeters), id };
}

// A pin is what the 200 m check-in geofence is measured from, so it can't be
// looser than the fence itself is meant to be tolerant of.
const MAX_PIN_ACCURACY_METERS = 100;

// Every endpoint that returns a single drive (create/update/submit/remove/
// findOne) uses this same include, so the frontend can treat their
// responses as interchangeable and merge them into the same state shape.
const DRIVE_DETAIL_INCLUDE = {
  slots: true,
  role: { select: { title: true, slug: true } },
  city: { select: { name: true, centerLat: true, centerLng: true } },
  owner: { select: PERSON_SELECT },
  reschedules: { include: { by: { select: PERSON_SELECT } }, orderBy: { version: "desc" } },
} as const;

type DriveWithDetail = Prisma.DriveGetPayload<{ include: typeof DRIVE_DETAIL_INCLUDE }>;

function withOwner<T extends Pick<DriveWithDetail, "companyId" | "owner">>(drive: T) {
  return { ...drive, owner: personRef(drive.owner, drive.companyId) };
}

function toDetail(drive: DriveWithDetail) {
  return {
    ...withOwner(drive),
    reschedules: drive.reschedules.map((r) => ({
      fromStartsAt: r.fromStartsAt.toISOString(),
      fromEndsAt: r.fromEndsAt.toISOString(),
      toStartsAt: r.toStartsAt.toISOString(),
      toEndsAt: r.toEndsAt.toISOString(),
      reseated: r.reseated,
      by: personRef(r.by, drive.companyId),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

function slotsTile(slots: { startsAt: Date }[], startsAt: Date, endsAt: Date, slotMs: number): boolean {
  return (
    slots.length > 0 &&
    slotMs > 0 &&
    slots.every((slot, i) => slot.startsAt.getTime() === startsAt.getTime() + i * slotMs) &&
    startsAt.getTime() + slots.length * slotMs === endsAt.getTime()
  );
}

// Every change to a drive names the person who made it: with several people
// at a company, "the company changed it" no longer says who.
function auditDrive(tx: Prisma.TransactionClient, userId: string, driveId: string, action: string, before: object | null, after: object) {
  return tx.auditLog.create({
    data: { actorUserId: userId, entityType: "drive", entityId: driveId, action, before: before ?? Prisma.DbNull, after },
  });
}

@Injectable()
export class DrivesService {
  constructor(
    private readonly geocoding: GeocodingService,
    private readonly jobs: JobsService,
  ) {}

  async create(userId: string, input: CreateDriveInput) {
    const { companyId } = await requireCompanyAccess(userId, "runDrives");
    const numberOfSlots = this.computeSlotCount(input.startsAt, input.endsAt, input.slotDurationMinutes);

    if (input.capacityPerSlot * numberOfSlots !== input.capacity) {
      throw new BadRequestException(
        apiError(
          "errors.drive.capacityMismatch",
          { capacity: input.capacity, perSlot: input.capacityPerSlot, slots: numberOfSlots, expected: input.capacityPerSlot * numberOfSlots },
          { field: "capacity" },
        ),
      );
    }

    const { venueLat, venueLng, needsManualGeocode } = await this.resolveCoordinates(
      input.cityId,
      input.venueAddress,
    );

    const drive = await prisma.$transaction(async (tx) => {
      const created = await tx.drive.create({
      data: {
        companyId,
        ownerId: userId,
        roleId: input.roleId,
        cityId: input.cityId,
        salaryMin: input.salaryMin,
        salaryMax: input.salaryMax,
        venueAddress: input.venueAddress,
        venueLat,
        venueLng,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        capacity: input.capacity,
        experienceMin: input.experienceMin,
        experienceMax: input.experienceMax,
        needsManualGeocode,
        knockoutQuestions: input.knockoutQuestions,
        status: "DRAFT",
        slots: {
          create: this.buildSlots(input.startsAt, numberOfSlots, input.slotDurationMinutes, input.capacityPerSlot),
        },
      },
      include: DRIVE_DETAIL_INCLUDE,
      });
      await auditDrive(tx, userId, created.id, "created", null, { status: "DRAFT" });
      return created;
    });
    await this.jobs.reembed({ kind: "drive", id: drive.id });
    return toDetail(drive);
  }

  async update(userId: string, driveId: string, input: UpdateDriveInput) {
    const { companyId } = await requireCompanyAccess(userId, "runDrives");
    const existing = await this.findOwned(companyId, driveId);

    if (existing.status !== "DRAFT" && existing.status !== "PENDING") {
      throw new BadRequestException(apiError("errors.drive.notEditable"));
    }
    // Changing the time through the edit form left the slots at the old
    // times. Only a reschedule moves a drive's time, and its slots with it.
    if (
      (input.startsAt && input.startsAt.getTime() !== existing.startsAt.getTime()) ||
      (input.endsAt && input.endsAt.getTime() !== existing.endsAt.getTime())
    ) {
      throw new BadRequestException(apiError("errors.drive.useReschedule"));
    }

    // The edit form sends every field on every save, so "present" is not
    // "changed". Re-geocoding an unchanged address would replace a venue
    // pinned from a device with the area-level guess it was pinned to fix.
    // A real address change means a different place, so the pin goes too.
    const addressChanged = input.venueAddress !== undefined && input.venueAddress !== existing.venueAddress;
    const cityChanged = input.cityId !== undefined && input.cityId !== existing.cityId;
    let geocodePatch:
      | { venueLat: number; venueLng: number; needsManualGeocode: boolean; venuePinnedAt: null }
      | undefined;
    if (addressChanged || cityChanged) {
      const cityId = input.cityId ?? existing.cityId;
      const venueAddress = input.venueAddress ?? existing.venueAddress;
      geocodePatch = { ...(await this.resolveCoordinates(cityId, venueAddress)), venuePinnedAt: null };
    }

    const drive = await prisma.$transaction(async (tx) => {
      const updated = await tx.drive.update({
        where: { id: driveId },
        data: { ...input, ...geocodePatch },
        include: DRIVE_DETAIL_INCLUDE,
      });
      await auditDrive(tx, userId, driveId, "edited", null, { fields: Object.keys(input) });
      return updated;
    });
    await this.jobs.reembed({ kind: "drive", id: drive.id });
    return toDetail(drive);
  }

  // Set from a device at the venue, usually on the day, so unlike other edits
  // this is allowed while the drive is LIVE.
  async pinVenue(userId: string, driveId: string, input: VenuePinInput) {
    const { companyId } = await requireCompanyAccess(userId, "runDrives");
    const existing = await this.findOwned(companyId, driveId);
    if (!["DRAFT", "PENDING", "LIVE"].includes(existing.status)) {
      throw new BadRequestException(apiError("errors.drive.venueLocked"));
    }
    if (input.accuracy > MAX_PIN_ACCURACY_METERS) {
      throw new BadRequestException(apiError("errors.drive.pinLoose", { accuracy: formatDistance(input.accuracy / 1000) }));
    }

    // A pin outside the drive's city fails quietly everywhere at once:
    // targeting matches nobody, the city map frames half the country and
    // every honest check-in is out of range. Past the furthest any candidate
    // may travel, the employer has to confirm the distance they were shown.
    const city = await prisma.city.findUniqueOrThrow({ where: { id: existing.cityId } });
    const km = haversineDistanceKm(city.centerLat, city.centerLng, input.lat, input.lng);
    const cityName = city.name;
    const farFromCity = km > MAX_TRAVEL_KM;
    if (farFromCity && !input.confirmFar) {
      throw new ConflictException(
        apiError("errors.drive.pinFar", { km: Math.round(km), city: cityName }, { distanceKm: Math.round(km), cityName }),
      );
    }

    const pinned = await prisma.$transaction(async (tx) => {
      const drive = await tx.drive.update({
        where: { id: driveId },
        data: { venueLat: input.lat, venueLng: input.lng, needsManualGeocode: false, venuePinnedAt: new Date() },
        include: DRIVE_DETAIL_INCLUDE,
      });
      await auditDrive(
        tx,
        userId,
        driveId,
        "venue_pinned",
        { venueLat: existing.venueLat, venueLng: existing.venueLng },
        {
          venueLat: input.lat,
          venueLng: input.lng,
          accuracyMeters: input.accuracy,
          ...(farFromCity ? { confirmedKmFromCity: Math.round(km) } : {}),
        },
      );
      return drive;
    });
    await this.jobs.reembed({ kind: "drive", id: driveId });
    return toDetail(pinned);
  }

  async submit(userId: string, driveId: string) {
    const { companyId } = await requireCompanyAccess(userId, "runDrives");
    const existing = await this.findOwned(companyId, driveId);

    if (existing.status !== "DRAFT") {
      throw new BadRequestException(apiError("errors.drive.submitOnlyDraft"));
    }

    return toDetail(await this.moveTo(userId, driveId, existing.status, "PENDING"));
  }

  // A suspended drive can't be cancelled out from under the review, and an
  // ended one has nothing left to cancel. Anyone booked is told not to come.
  async remove(userId: string, driveId: string) {
    const { companyId } = await requireCompanyAccess(userId, "runDrives");
    const existing = await this.findOwned(companyId, driveId);
    requireNotSuspended(existing);
    if (!["DRAFT", "PENDING", "LIVE"].includes(existing.status)) throw new BadRequestException(apiError("errors.drive.notCancellable"));
    const cancelled = await this.moveTo(userId, driveId, existing.status, "CANCELLED");
    if (existing.status === "LIVE") await this.jobs.alertBooked(driveId, "drive_cancelled");
    return toDetail(cancelled);
  }

  // Owners answer for who answers for a drive. The new owner must be able to
  // run it.
  async reassign(userId: string, driveId: string, ownerId: string) {
    const { companyId } = await requireCompanyAccess(userId, "managePeople");
    const existing = await this.findOwned(companyId, driveId);
    const next = await prisma.user.findFirst({
      where: { id: ownerId, companyId, companyRole: { in: ["OWNER", "RECRUITER"] } },
    });
    if (!next) throw new BadRequestException(apiError("errors.people.notARecruiter"));
    const drive = await prisma.$transaction(async (tx) => {
      const updated = await tx.drive.update({ where: { id: driveId }, data: { ownerId }, include: DRIVE_DETAIL_INCLUDE });
      await auditDrive(tx, userId, driveId, "owner_changed", { ownerId: existing.ownerId }, { ownerId });
      return updated;
    });
    return toDetail(drive);
  }

  // Moves a drive's time and its slots with it, and tells everyone booked.
  // Slots keep their length and order: a longer window gains slots at the
  // end with the same seats, a shorter one loses slots from the end and
  // moves the people booked into them to the nearest remaining slot that
  // hasn't started and has room. If anyone can't be moved, nothing changes:
  // the employer sees exactly who would be stranded, and a drive that can't
  // run at all is cancelled, which tells everyone properly. Once check-in
  // has opened the start is fixed, since people may already be there.
  async reschedule(userId: string, driveId: string, { startsAt, endsAt }: RescheduleDriveInput) {
    const { companyId } = await requireCompanyAccess(userId, "runDrives");
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      // Locks the drive and its slots against a booking or another
      // reschedule arriving mid-way.
      await tx.$queryRaw`SELECT id FROM drives WHERE id = ${driveId} AND "companyId" = ${companyId} FOR UPDATE`;
      const drive = await tx.drive.findFirst({ where: { id: driveId, companyId }, include: { slots: { orderBy: { startsAt: "asc" } } } });
      if (!drive) throw new NotFoundException(apiError("errors.drive.notFound"));
      requireNotSuspended(drive);
      if (!["DRAFT", "PENDING", "LIVE"].includes(drive.status) || drive.endsAt <= now) {
        throw new BadRequestException(apiError("errors.drive.notReschedulable"));
      }
      await tx.$queryRaw`SELECT id FROM drive_slots WHERE "driveId" = ${driveId} FOR UPDATE`;

      // Everything below works out where slots go, and where the people in
      // them go, from slots that fill the drive's window end to end in equal
      // steps from its start, as create() makes them. A drive whose slots
      // don't is refused here rather than reseated on a wrong assumption.
      const slotMs = drive.slots.length > 1 ? drive.slots[1].startsAt.getTime() - drive.slots[0].startsAt.getTime() : drive.endsAt.getTime() - drive.startsAt.getTime();
      if (!slotsTile(drive.slots, drive.startsAt, drive.endsAt, slotMs)) {
        throw new ConflictException(apiError("errors.drive.slotsDontTile"));
      }

      const begun = drive.status === "LIVE" && now.getTime() >= drive.startsAt.getTime() - CHECK_IN_OPENS_BEFORE_START_MS;
      if (begun && startsAt.getTime() !== drive.startsAt.getTime()) {
        throw new BadRequestException(apiError("errors.drive.startLocked", { time: formatTime(drive.startsAt.toISOString()) }));
      }
      if (!begun && startsAt <= now) throw new BadRequestException(apiError("errors.drive.rescheduleIntoPast"));
      if (endsAt <= now) throw new BadRequestException(apiError("errors.drive.rescheduleIntoPast"));

      const windowMs = endsAt.getTime() - startsAt.getTime();
      if (windowMs % slotMs !== 0) {
        throw new BadRequestException(apiError("errors.drive.slotsUneven", { minutes: slotMs / 60_000 }, { field: "endsAt" }));
      }
      const count = windowMs / slotMs;
      const shift = startsAt.getTime() - drive.startsAt.getTime();
      const kept = drive.slots.slice(0, count).map((slot) => ({ ...slot, startsAt: new Date(slot.startsAt.getTime() + shift) }));
      const dropped = drive.slots.slice(count);
      const perSlot = drive.slots[drive.slots.length - 1]?.capacity ?? drive.capacity;

      // Everyone booked into a dropped slot, moved to the latest remaining
      // slot that hasn't started and has room: the nearest to the time they
      // chose.
      const stranded = await tx.application.findMany({
        where: { slotId: { in: dropped.map((s) => s.id) }, state: "CONFIRMED" },
        include: { candidate: { include: { user: { select: { name: true } } } } },
      });
      const room = new Map(kept.map((s) => [s.id, s.capacity - s.bookedCount]));
      const moves: { applicationId: string; slotId: string }[] = [];
      const unplaced: string[] = [];
      for (const application of stranded) {
        const target = [...kept].reverse().find((s) => s.startsAt > now && (room.get(s.id) ?? 0) > 0);
        if (!target) {
          unplaced.push(application.candidate.user.name);
          continue;
        }
        room.set(target.id, room.get(target.id)! - 1);
        moves.push({ applicationId: application.id, slotId: target.id });
      }
      if (unplaced.length > 0) {
        throw new ConflictException(
          apiError(
            "errors.drive.rescheduleStrands",
            { count: unplaced.length, names: new Intl.ListFormat(INTL_LOCALE[DEFAULT_LOCALE], { type: "conjunction" }).format(unplaced) },
            { stranded: unplaced },
          ),
        );
      }

      for (const slot of kept) await tx.driveSlot.update({ where: { id: slot.id }, data: { startsAt: slot.startsAt } });
      for (const move of moves) {
        await tx.application.update({ where: { id: move.applicationId }, data: { slotId: move.slotId } });
        await tx.driveSlot.update({ where: { id: move.slotId }, data: { bookedCount: { increment: 1 } } });
      }
      // Anyone still pointing at a dropped slot isn't holding a seat in it
      // (they withdrew, arrived early or were turned away); the record of
      // their slot goes with it.
      await tx.application.updateMany({ where: { slotId: { in: dropped.map((s) => s.id) } }, data: { slotId: null } });
      await tx.driveSlot.deleteMany({ where: { id: { in: dropped.map((s) => s.id) } } });
      const added = Array.from({ length: Math.max(0, count - drive.slots.length) }, (_, i) => ({
        driveId,
        startsAt: new Date(startsAt.getTime() + (drive.slots.length + i) * slotMs),
        capacity: perSlot,
      }));
      if (added.length) await tx.driveSlot.createMany({ data: added });

      const version = drive.scheduleVersion + 1;
      const capacity = kept.reduce((sum, s) => sum + s.capacity, 0) + added.length * perSlot;
      await tx.drive.update({ where: { id: driveId }, data: { startsAt, endsAt, capacity, scheduleVersion: version } });
      await tx.driveReschedule.create({
        data: {
          driveId,
          version,
          fromStartsAt: drive.startsAt,
          fromEndsAt: drive.endsAt,
          toStartsAt: startsAt,
          toEndsAt: endsAt,
          reseated: moves.length,
          byId: userId,
        },
      });
      await auditDrive(
        tx,
        userId,
        driveId,
        "rescheduled",
        { startsAt: drive.startsAt, endsAt: drive.endsAt },
        { startsAt, endsAt, version, reseated: moves.map((m) => m.applicationId) },
      );
      return { live: drive.status === "LIVE", version };
    });

    if (result.live) await this.jobs.alertBooked(driveId, "drive_rescheduled", result.version);
    return toDetail(await prisma.drive.findUniqueOrThrow({ where: { id: driveId }, include: DRIVE_DETAIL_INCLUDE }));
  }

  private moveTo(userId: string, driveId: string, from: string, to: "PENDING" | "CANCELLED") {
    return prisma.$transaction(async (tx) => {
      const drive = await tx.drive.update({ where: { id: driveId }, data: { status: to }, include: DRIVE_DETAIL_INCLUDE });
      await auditDrive(tx, userId, driveId, `${from}->${to}`, { status: from }, { status: to });
      return drive;
    });
  }

  async listMine(userId: string, cursor: string | undefined, limit: number) {
    const { companyId } = await requireCompanyAccess(userId, "read");
    const drives = await prisma.drive.findMany({
      where: { companyId },
      include: { role: { select: { title: true, slug: true } }, owner: { select: PERSON_SELECT } },
      orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = drives.length > limit;
    const items = hasMore ? drives.slice(0, limit) : drives;

    // Summed in the database for the whole page in one grouped query, so the
    // list stays two round trips however many drives it returns.
    const sums = await prisma.driveSlot.groupBy({
      by: ["driveId"],
      where: { driveId: { in: items.map((d) => d.id) } },
      _sum: { bookedCount: true },
    });
    const booked = new Map(sums.map((s) => [s.driveId, s._sum.bookedCount ?? 0]));

    return {
      items: items.map((d) => ({ ...withOwner(d), bookedCount: booked.get(d.id) ?? 0 })),
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }

  // Public search: only LIVE drives that have not ended, distance-ordered
  // from the resolved origin (a logged-in candidate's home, or the filtered
  // city's center). Ended drives are excluded here rather than hidden on the
  // page so cursor pages stay full. Raw SQL because ST_Distance/ST_DWithin
  // operate on the Unsupported geom column, which Prisma cannot reference.
  async search(query: DriveSearchQuery, currentUserId: string | null): Promise<DriveSearchPage> {
    const limit = query.limit ?? 20;

    const cityId = query.city
      ? (await prisma.city.findFirst({ where: { name: { equals: query.city, mode: "insensitive" } } }))?.id
      : undefined;

    if (query.city && !cityId) {
      return { items: [], nextCursor: null };
    }

    const roleId = query.role ? (await prisma.role.findUnique({ where: { slug: query.role } }))?.id : undefined;

    if (query.role && !roleId) {
      return { items: [], nextCursor: null };
    }

    const origin = await this.resolveSearchOrigin(currentUserId, cityId);
    if (!origin) {
      throw new BadRequestException(apiError("errors.drive.searchNeedsPlace"));
    }

    // endsAt is a UTC timestamp without zone, so compare against now in UTC
    // explicitly instead of relying on the session time zone.
    const conditions: Prisma.Sql[] = [
      Prisma.sql`d.status = 'LIVE'`,
      Prisma.sql`d."endsAt" > (now() AT TIME ZONE 'UTC')`,
    ];
    if (cityId) conditions.push(Prisma.sql`d."cityId" = ${cityId}`);
    if (roleId) conditions.push(Prisma.sql`d."roleId" = ${roleId}`);
    if (query.fromDate) conditions.push(Prisma.sql`d."startsAt" >= ${query.fromDate}`);
    if (query.toDate) conditions.push(Prisma.sql`d."startsAt" <= ${query.toDate}`);
    if (query.radiusKm) {
      conditions.push(
        Prisma.sql`ST_DWithin(d.geom, ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography, ${query.radiusKm * 1000})`,
      );
    }
    if (query.cursor) {
      const { distanceMeters, id } = decodeCursor(query.cursor);
      conditions.push(
        Prisma.sql`(ST_Distance(d.geom, ST_SetSRID(ST_MakePoint(${origin.lng}, ${origin.lat}), 4326)::geography), d.id) > (${distanceMeters}, ${id})`,
      );
    }

    const rows = await prisma.$queryRaw<RawSearchRow[]>`
      SELECT ${publicDriveColumns(origin)}
      FROM drives d
      JOIN roles r ON r.id = d."roleId"
      JOIN cities c ON c.id = d."cityId"
      WHERE ${Prisma.join(conditions, " AND ")}
      ORDER BY "distanceMeters" ASC, d.id ASC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return driveSearchPageSchema.parse({
      items: items.map(toSearchResult),
      nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null,
    });
  }

  async findPublicOne(driveId: string, currentUserId: string | null): Promise<PublicDriveDetail> {
    // EXPIRED is served as well as LIVE so a stale forwarded link shows that
    // the drive has ended instead of a 404, and SUSPENDED so someone arriving
    // from an alert learns it is paused. Drafts and pending drives stay
    // private.
    const drive = await prisma.drive.findFirst({
      where: { id: driveId, status: { in: ["LIVE", "EXPIRED", "SUSPENDED"] } },
      select: { cityId: true, knockoutQuestions: true, company: { select: { verificationStatus: true } } },
    });
    if (!drive) {
      throw new NotFoundException(apiError("errors.drive.notFound"));
    }

    // cityId always resolves to a real City row via its FK, so this can
    // only be null if resolveSearchOrigin's candidate-lookup path also
    // misses — which it does not, since we pass a concrete cityId here.
    const origin = (await this.resolveSearchOrigin(currentUserId, drive.cityId))!;

    const [[row], slots] = await Promise.all([
      prisma.$queryRaw<RawSearchRow[]>`
        SELECT ${publicDriveColumns(origin)}
        FROM drives d
        JOIN roles r ON r.id = d."roleId"
        JOIN cities c ON c.id = d."cityId"
        WHERE d.id = ${driveId}
      `,
      prisma.driveSlot.findMany({
        where: { driveId },
        select: { id: true, startsAt: true, capacity: true, bookedCount: true },
        orderBy: { startsAt: "asc" },
      }),
    ]);

    return publicDriveDetailSchema.parse({
      ...toSearchResult(row),
      slots: slots.map((slot) => ({ ...slot, startsAt: slot.startsAt.toISOString() })),
      knockoutQuestions: publicKnockoutQuestions(knockoutQuestionsSchema.parse(drive.knockoutQuestions)),
      employerVerified: drive.company.verificationStatus === "VERIFIED",
    });
  }

  private async resolveSearchOrigin(
    currentUserId: string | null,
    cityId: string | undefined,
  ): Promise<{ lat: number; lng: number } | null> {
    if (currentUserId) {
      const candidate = await prisma.candidate.findUnique({ where: { userId: currentUserId } });
      if (candidate) {
        return { lat: candidate.homeLat, lng: candidate.homeLng };
      }
    }
    if (cityId) {
      const city = await prisma.city.findUnique({ where: { id: cityId } });
      if (city) {
        return { lat: city.centerLat, lng: city.centerLng };
      }
    }
    return null;
  }

  async findOne(userId: string, driveId: string) {
    const { companyId } = await requireCompanyAccess(userId, "read");
    const drive = await prisma.drive.findFirst({
      where: { id: driveId, companyId },
      include: DRIVE_DETAIL_INCLUDE,
    });
    if (!drive) {
      throw new NotFoundException(apiError("errors.drive.notFound"));
    }
    // A drive sent back from review returns to DRAFT; the reviewer's reason is
    // in the audit log, and the employer needs it to fix the drive.
    const review = await prisma.auditLog.findFirst({
      where: { entityType: "drive", entityId: driveId, action: "PENDING->DRAFT" },
      orderBy: { createdAt: "desc" },
    });
    // An empty note means review sent it back without saying why; the page
    // words that itself.
    const reason = (review?.after as { reason?: string } | null)?.reason;
    return { ...toDetail(drive), reviewNote: drive.status === "DRAFT" && review ? (reason ?? "") : null };
  }

  // Company-scoping enforcement point: every by-id operation (update, submit,
  // remove) goes through this lookup, which filters by companyId in the
  // WHERE clause itself rather than fetching-then-checking. A drive
  // belonging to another company is indistinguishable from one that doesn't
  // exist (404, not 403) — we never confirm another company's drive exists.
  private async findOwned(companyId: string, driveId: string) {
    const drive = await prisma.drive.findFirst({ where: { id: driveId, companyId } });
    if (!drive) {
      throw new NotFoundException(apiError("errors.drive.notFound"));
    }
    return drive;
  }

  private async resolveCoordinates(cityId: string, venueAddress: string) {
    const geocoded = await this.geocoding.geocode(venueAddress);
    if (geocoded) {
      return { venueLat: geocoded.lat, venueLng: geocoded.lng, needsManualGeocode: false };
    }

    // Nominatim failed or found nothing: fall back to the city's center so
    // the drive still saves, flagged for the employer to fix manually.
    const city = await prisma.city.findUniqueOrThrow({ where: { id: cityId } });
    return { venueLat: city.centerLat, venueLng: city.centerLng, needsManualGeocode: true };
  }

  private computeSlotCount(startsAt: Date, endsAt: Date, slotDurationMinutes: number): number {
    const totalMinutes = (endsAt.getTime() - startsAt.getTime()) / 60_000;
    if (totalMinutes <= 0 || totalMinutes % slotDurationMinutes !== 0) {
      throw new BadRequestException(apiError("errors.drive.slotsUneven", { minutes: slotDurationMinutes }, { field: "slotDurationMinutes" }));
    }
    return totalMinutes / slotDurationMinutes;
  }

  private buildSlots(startsAt: Date, numberOfSlots: number, slotDurationMinutes: number, capacityPerSlot: number) {
    return Array.from({ length: numberOfSlots }, (_, index) => ({
      startsAt: new Date(startsAt.getTime() + index * slotDurationMinutes * 60_000),
      capacity: capacityPerSlot,
    }));
  }
}
