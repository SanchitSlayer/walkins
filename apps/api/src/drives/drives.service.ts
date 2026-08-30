import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "@walkins/db";
import type { CreateDriveInput, UpdateDriveInput } from "@walkins/shared";
import { GeocodingService } from "./geocoding.service";

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

    let geocodePatch: { venueLat: number; venueLng: number; needsManualGeocode: boolean } | undefined;
    if (input.venueAddress !== undefined || input.cityId !== undefined) {
      const cityId = input.cityId ?? existing.cityId;
      const venueAddress = input.venueAddress ?? existing.venueAddress;
      geocodePatch = await this.resolveCoordinates(cityId, venueAddress);
    }

    return prisma.drive.update({
      where: { id: driveId },
      data: { ...input, ...geocodePatch },
      include: DRIVE_DETAIL_INCLUDE,
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

    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
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
