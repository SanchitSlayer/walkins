import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
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
  publicDriveDetailSchema,
} from "@walkins/shared";
import { GeocodingService } from "./geocoding.service";

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
} as const;

@Injectable()
export class DrivesService {
  constructor(private readonly geocoding: GeocodingService) {}

  async create(companyId: string, input: CreateDriveInput) {
    const numberOfSlots = this.computeSlotCount(input.startsAt, input.endsAt, input.slotDurationMinutes);

    if (input.capacityPerSlot * numberOfSlots !== input.capacity) {
      throw new BadRequestException(
        `capacity (${input.capacity}) must equal capacityPerSlot * number of slots ` +
          `(${input.capacityPerSlot} * ${numberOfSlots} = ${input.capacityPerSlot * numberOfSlots})`,
      );
    }

    const { venueLat, venueLng, needsManualGeocode } = await this.resolveCoordinates(
      input.cityId,
      input.venueAddress,
    );

    return prisma.drive.create({
      data: {
        companyId,
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
        status: "DRAFT",
        slots: {
          create: this.buildSlots(input.startsAt, numberOfSlots, input.slotDurationMinutes, input.capacityPerSlot),
        },
      },
      include: DRIVE_DETAIL_INCLUDE,
    });
  }

  async update(companyId: string, driveId: string, input: UpdateDriveInput) {
    const existing = await this.findOwned(companyId, driveId);

    if (existing.status !== "DRAFT" && existing.status !== "PENDING") {
      throw new BadRequestException("A drive can only be edited while DRAFT or PENDING");
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

    return prisma.drive.update({
      where: { id: driveId },
      data: { ...input, ...geocodePatch },
      include: DRIVE_DETAIL_INCLUDE,
    });
  }

  // Set from a device at the venue, usually on the day, so unlike other edits
  // this is allowed while the drive is LIVE.
  async pinVenue(companyId: string, userId: string, driveId: string, input: VenuePinInput) {
    const existing = await this.findOwned(companyId, driveId);
    if (!["DRAFT", "PENDING", "LIVE"].includes(existing.status)) {
      throw new BadRequestException("A cancelled or ended drive's venue can't be moved");
    }
    if (input.accuracy > MAX_PIN_ACCURACY_METERS) {
      throw new BadRequestException(
        `This device's location is only accurate to ±${Math.round(input.accuracy)} m, too loose to anchor a ` +
          "200 m check-in zone. Turn Wi-Fi on or move nearer a window, then try again.",
      );
    }

    return prisma.$transaction(async (tx) => {
      const drive = await tx.drive.update({
        where: { id: driveId },
        data: { venueLat: input.lat, venueLng: input.lng, needsManualGeocode: false, venuePinnedAt: new Date() },
        include: DRIVE_DETAIL_INCLUDE,
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          entityType: "drive",
          entityId: driveId,
          action: "venue_pinned",
          before: { venueLat: existing.venueLat, venueLng: existing.venueLng },
          after: { venueLat: input.lat, venueLng: input.lng, accuracyMeters: input.accuracy },
        },
      });
      return drive;
    });
  }

  async submit(companyId: string, driveId: string) {
    const existing = await this.findOwned(companyId, driveId);

    if (existing.status !== "DRAFT") {
      throw new BadRequestException("Only a DRAFT drive can be submitted");
    }

    return prisma.drive.update({
      where: { id: driveId },
      data: { status: "PENDING" },
      include: DRIVE_DETAIL_INCLUDE,
    });
  }

  async remove(companyId: string, driveId: string) {
    await this.findOwned(companyId, driveId);
    return prisma.drive.update({
      where: { id: driveId },
      data: { status: "CANCELLED" },
      include: DRIVE_DETAIL_INCLUDE,
    });
  }

  async listMine(companyId: string, cursor: string | undefined, limit: number) {
    const drives = await prisma.drive.findMany({
      where: { companyId },
      include: { role: { select: { title: true, slug: true } } },
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
      items: items.map((d) => ({ ...d, bookedCount: booked.get(d.id) ?? 0 })),
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
      throw new BadRequestException("Specify a city, or log in with a saved home location, to search drives");
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
    // the drive has ended instead of a 404, including after the Phase 4
    // expiry job starts writing EXPIRED. Drafts and pending drives stay private.
    const drive = await prisma.drive.findFirst({
      where: { id: driveId, status: { in: ["LIVE", "EXPIRED"] } },
      select: { cityId: true },
    });
    if (!drive) {
      throw new NotFoundException("Drive not found");
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

  async findOne(companyId: string, driveId: string) {
    const drive = await prisma.drive.findFirst({
      where: { id: driveId, companyId },
      include: DRIVE_DETAIL_INCLUDE,
    });
    if (!drive) {
      throw new NotFoundException("Drive not found");
    }
    return drive;
  }

  // Company-scoping enforcement point: every by-id operation (update, submit,
  // remove) goes through this lookup, which filters by companyId in the
  // WHERE clause itself rather than fetching-then-checking. A drive
  // belonging to another company is indistinguishable from one that doesn't
  // exist (404, not 403) — we never confirm another company's drive exists.
  private async findOwned(companyId: string, driveId: string) {
    const drive = await prisma.drive.findFirst({ where: { id: driveId, companyId } });
    if (!drive) {
      throw new NotFoundException("Drive not found");
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
      throw new BadRequestException("The drive's time window must divide evenly by slotDurationMinutes");
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
