import { prisma } from "@walkins/db";
import { redis } from "../src/common/redis";

// Real rows in the local database, because the guarantees under test (the
// conditional seat update, the unique indexes, compare-and-set transitions)
// live in Postgres. Everything created here is removed by removeFixture.
function randomPhone() {
  return `8${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
}

export async function createFixture(label: string, candidateCount: number) {
  const city = await prisma.city.findFirstOrThrow({ where: { name: "Bengaluru" } });
  const role = await prisma.role.findFirstOrThrow();
  const company = await prisma.company.create({
    data: { name: `${label} Company`, contactPhone: randomPhone(), cityId: city.id, verificationStatus: "VERIFIED" },
  });
  const employer = await prisma.user.create({
    data: { phone: randomPhone(), name: `${label} Employer`, role: "EMPLOYER", companyId: company.id },
  });

  const candidates: { userId: string; candidateId: string }[] = [];
  for (let i = 0; i < candidateCount; i++) {
    const user = await prisma.user.create({ data: { phone: randomPhone(), name: `${label} Candidate ${i}`, role: "CANDIDATE" } });
    const candidate = await prisma.candidate.create({
      data: { userId: user.id, cityId: city.id, homeLat: city.centerLat, homeLng: city.centerLng, maxTravelKm: 10, experienceYears: 1 },
    });
    candidates.push({ userId: user.id, candidateId: candidate.id });
  }

  const venue = { lat: city.centerLat + 0.01, lng: city.centerLng };
  const now = Date.now();
  // Opened ten minutes ago so check-in is open; both slots are still ahead so
  // they can be booked. One seat to race for, and enough room for every test
  // that just needs somebody booked.
  const drive = await prisma.drive.create({
    data: {
      companyId: company.id,
      roleId: role.id,
      cityId: city.id,
      salaryMin: 15000,
      salaryMax: 20000,
      venueAddress: `${label} Venue`,
      venueLat: venue.lat,
      venueLng: venue.lng,
      startsAt: new Date(now - 10 * 60_000),
      endsAt: new Date(now + 3 * 3600_000),
      capacity: 21,
      experienceMin: 0,
      experienceMax: 5,
      status: "LIVE",
      slots: {
        create: [
          { startsAt: new Date(now + 3600_000), capacity: 1 },
          { startsAt: new Date(now + 2 * 3600_000), capacity: 20 },
        ],
      },
    },
    include: { slots: { orderBy: { startsAt: "asc" } } },
  });

  return {
    company,
    employer,
    candidates,
    drive,
    venue,
    lastSeatSlot: drive.slots[0],
    roomySlot: drive.slots[1],
  };
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>;

export async function removeFixture(fixture: Fixture) {
  const driveId = fixture.drive.id;
  const applications = await prisma.application.findMany({ where: { driveId }, select: { id: true } });
  const checkIns = await prisma.checkIn.findMany({ where: { application: { driveId } }, select: { id: true } });
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: [driveId, fixture.company.id, ...applications.map((a) => a.id), ...checkIns.map((c) => c.id)] } },
  });
  // Ledger rows are append-only and stay behind, which is why tests run
  // against their own database (test/setup.ts). Payment orders are not.
  await prisma.paymentOrder.deleteMany({ where: { companyId: fixture.company.id } });
  await prisma.checkIn.deleteMany({ where: { application: { driveId } } });
  await prisma.application.deleteMany({ where: { driveId } });
  await prisma.driveSlot.deleteMany({ where: { driveId } });
  await prisma.drive.delete({ where: { id: driveId } });
  await prisma.candidate.deleteMany({ where: { id: { in: fixture.candidates.map((c) => c.candidateId) } } });
  await prisma.user.deleteMany({
    where: { id: { in: [fixture.employer.id, ...fixture.candidates.map((c) => c.userId)] } },
  });
  await prisma.company.delete({ where: { id: fixture.company.id } });

  for (const { candidateId } of fixture.candidates) {
    const keys = await redis.keys(`checkin-nonce:*:${candidateId}`);
    if (keys.length) await redis.del(...keys);
  }
}
