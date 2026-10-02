import { BadRequestException, ConflictException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@walkins/db";
import { redis } from "../src/common/redis";
import { DrivesService } from "../src/drives/drives.service";
import type { GeocodingService } from "../src/drives/geocoding.service";
import { createFixture, type Fixture, removeFixture } from "./fixtures";

// Pinning never geocodes, so the geocoder is never reached.
const drives = new DrivesService({} as GeocodingService);
const JODHPUR = { lat: 26.2389, lng: 73.0243 };
let fixture: Fixture;

beforeAll(async () => {
  fixture = await createFixture("Pin Test", 0);
});

afterAll(async () => {
  await removeFixture(fixture);
  await prisma.$disconnect();
  redis.disconnect();
});

function pin(input: { lat: number; lng: number; accuracy: number; confirmFar?: boolean }) {
  return drives.pinVenue(fixture.company.id, fixture.employer.id, fixture.drive.id, input);
}

describe("pinning the venue", () => {
  it("pins a point inside the drive's city without asking", async () => {
    const drive = await pin({ lat: fixture.venue.lat + 0.001, lng: fixture.venue.lng, accuracy: 30 });

    expect(drive.venuePinnedAt).not.toBeNull();
    expect(drive.needsManualGeocode).toBe(false);
  });

  it("asks before pinning far outside the city, naming the distance", async () => {
    const err = await pin({ ...JODHPUR, accuracy: 30 }).catch((e) => e);

    expect(err).toBeInstanceOf(ConflictException);
    const body = err.getResponse();
    expect(body).toMatchObject({ code: "PIN_FAR_FROM_CITY", cityName: "Bengaluru" });
    expect(body.distanceKm).toBeGreaterThan(1400);
    expect(body.message).toMatch(/km from the centre of Bengaluru/);
    const unchanged = await prisma.drive.findUniqueOrThrow({ where: { id: fixture.drive.id } });
    expect(unchanged.venueLat).not.toBeCloseTo(JODHPUR.lat, 1);
  });

  it("pins far away once confirmed, and records that it was confirmed", async () => {
    const drive = await pin({ ...JODHPUR, accuracy: 30, confirmFar: true });

    expect(drive.venueLat).toBeCloseTo(JODHPUR.lat, 4);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: fixture.drive.id, action: "venue_pinned" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.actorUserId).toBe(fixture.employer.id);
    expect((audit.after as { confirmedKmFromCity?: number }).confirmedKmFromCity).toBeGreaterThan(1400);
  });

  it("refuses a loose reading before ever asking about distance", async () => {
    await expect(pin({ ...JODHPUR, accuracy: 400 })).rejects.toBeInstanceOf(BadRequestException);
  });
});
