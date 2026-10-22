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
    data: { phone: randomPhone(), name: `${label} Employer`, role: "EMPLOYER", companyId: company.id, companyRole: "OWNER" },
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
      ownerId: employer.id,
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
    // Created by addPerson, removed with the fixture.
    extraUserIds: [] as string[],
    extraCompanyIds: [] as string[],
  };
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>;

// Someone else at the fixture's company, in the given role; or, with
// elsewhere, the owner of a different company of their own; or, with no
// role, a signed-up account in no company at all.
export async function addPerson(fixture: Fixture, label: string, role: "OWNER" | "RECRUITER" | "VIEWER" | null, elsewhere = false) {
  let companyId: string | null = role ? fixture.company.id : null;
  if (elsewhere) {
    const other = await prisma.company.create({
      data: { name: `${label} Company`, contactPhone: randomPhone(), cityId: fixture.company.cityId, verificationStatus: "VERIFIED" },
    });
    fixture.extraCompanyIds.push(other.id);
    companyId = other.id;
  }
  const user = await prisma.user.create({
    data: {
      phone: randomPhone(),
      name: label,
      role: companyId ? "EMPLOYER" : "CANDIDATE",
      companyId,
      companyRole: companyId ? (role ?? "OWNER") : null,
    },
  });
  fixture.extraUserIds.push(user.id);
  return user;
}

export async function removeFixture(fixture: Fixture) {
  const companyIds = [fixture.company.id, ...fixture.extraCompanyIds];
  const allDriveIds = (await prisma.drive.findMany({ where: { companyId: { in: companyIds } }, select: { id: true } })).map((d) => d.id);
  const applications = await prisma.application.findMany({ where: { driveId: { in: allDriveIds } }, select: { id: true } });
  const checkIns = await prisma.checkIn.findMany({ where: { application: { driveId: { in: allDriveIds } } }, select: { id: true } });
  await prisma.auditLog.deleteMany({
    where: { entityId: { in: [...allDriveIds, ...companyIds, ...applications.map((a) => a.id), ...checkIns.map((c) => c.id)] } },
  });
  await prisma.companyInvitation.deleteMany({ where: { companyId: { in: companyIds } } });
  const candidateIds = fixture.candidates.map((c) => c.candidateId);
  await prisma.warning.deleteMany({ where: { OR: [{ companyId: { in: companyIds } }, { candidateId: { in: candidateIds } }] } });
  const threadScope = { thread: { application: { driveId: { in: allDriveIds } } } };
  await prisma.report.deleteMany({ where: { OR: [{ driveId: { in: allDriveIds } }, { candidateId: { in: candidateIds } }, { message: threadScope }] } });
  await prisma.notification.deleteMany({ where: { driveId: { in: allDriveIds } } });
  const threadIds = (await prisma.messageThread.findMany({ where: { application: { driveId: { in: allDriveIds } } }, select: { id: true } })).map((t) => t.id);
  await prisma.auditLog.deleteMany({ where: { entityId: { in: threadIds } } });
  await prisma.message.deleteMany({ where: threadScope });
  await prisma.messageThread.deleteMany({ where: { application: { driveId: { in: allDriveIds } } } });
  await prisma.moderationAction.deleteMany({
    where: { OR: [{ driveId: { in: allDriveIds } }, { companyId: { in: companyIds } }, { candidateId: { in: candidateIds } }] },
  });
  await prisma.verificationSubmission.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.driveReschedule.deleteMany({ where: { driveId: { in: allDriveIds } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: candidateIds } } });
  // Ledger rows are append-only and stay behind, which is why tests run
  // against their own database (test/setup.ts). Payment orders are not.
  await prisma.paymentOrder.deleteMany({ where: { companyId: fixture.company.id } });
  await prisma.checkIn.deleteMany({ where: { application: { driveId: { in: allDriveIds } } } });
  await prisma.application.deleteMany({ where: { driveId: { in: allDriveIds } } });
  await prisma.driveSlot.deleteMany({ where: { driveId: { in: allDriveIds } } });
  await prisma.drive.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.candidate.deleteMany({ where: { id: { in: fixture.candidates.map((c) => c.candidateId) } } });
  await prisma.user.deleteMany({
    where: { id: { in: [fixture.employer.id, ...fixture.extraUserIds, ...fixture.candidates.map((c) => c.userId)] } },
  });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });

  for (const { candidateId } of fixture.candidates) {
    const keys = await redis.keys(`checkin-nonce:*:${candidateId}`);
    if (keys.length) await redis.del(...keys);
  }
}
