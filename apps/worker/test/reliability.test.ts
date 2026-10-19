import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@walkins/db";
import { recomputeReliability } from "../src/maintenance/maintenance-jobs";

// Real rows, because the bug was in the SQL: a booking on a drive the
// employer cancelled was scored as a missed interview. Each run is scoped to
// this file's candidates (see "Scope every maintenance function" in the
// README).
const ids = { company: "", owner: "", users: [] as string[], candidates: [] as string[], drives: [] as string[] };

function randomPhone() {
  return `6${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
}

beforeAll(async () => {
  const city = await prisma.city.findFirstOrThrow({ where: { name: "Bengaluru" } });
  const role = await prisma.role.findFirstOrThrow();
  const company = await prisma.company.create({ data: { name: "Reliability Test Company", contactPhone: randomPhone(), cityId: city.id, verificationStatus: "VERIFIED" } });
  const owner = await prisma.user.create({ data: { phone: randomPhone(), name: "Reliability Owner", role: "EMPLOYER", companyId: company.id, companyRole: "OWNER" } });
  Object.assign(ids, { company: company.id, owner: owner.id });

  const ended = new Date(Date.now() - 24 * 3600_000);
  const drive = (status: "EXPIRED" | "CANCELLED" | "SUSPENDED") =>
    prisma.drive.create({
      data: {
        companyId: company.id,
        ownerId: owner.id,
        roleId: role.id,
        cityId: city.id,
        salaryMin: 15000,
        salaryMax: 20000,
        venueAddress: "Reliability Test Venue",
        venueLat: city.centerLat,
        venueLng: city.centerLng,
        startsAt: new Date(ended.getTime() - 3 * 3600_000),
        endsAt: ended,
        capacity: 5,
        experienceMin: 0,
        experienceMax: 5,
        status,
      },
    });
  const [ran, cancelled, suspended] = await Promise.all([drive("EXPIRED"), drive("CANCELLED"), drive("SUSPENDED")]);
  ids.drives.push(ran.id, cancelled.id, suspended.id);

  for (const name of ["attended", "only-cancelled"]) {
    const user = await prisma.user.create({ data: { phone: randomPhone(), name: `Reliability ${name}`, role: "CANDIDATE" } });
    const candidate = await prisma.candidate.create({
      // A damaged score from before the fix, which the recompute must repair.
      data: { userId: user.id, cityId: city.id, homeLat: city.centerLat, homeLng: city.centerLng, maxTravelKm: 10, experienceYears: 1, reliability: 0.5 },
    });
    ids.users.push(user.id);
    ids.candidates.push(candidate.id);
  }
  const [attended, onlyCancelled] = ids.candidates;
  await prisma.application.createMany({
    data: [
      { driveId: ran.id, candidateId: attended, state: "CHECKED_IN" },
      { driveId: cancelled.id, candidateId: attended, state: "CONFIRMED" },
      { driveId: suspended.id, candidateId: attended, state: "CONFIRMED" },
      { driveId: cancelled.id, candidateId: onlyCancelled, state: "CONFIRMED" },
    ],
  });
});

afterAll(async () => {
  await prisma.application.deleteMany({ where: { driveId: { in: ids.drives } } });
  await prisma.drive.deleteMany({ where: { id: { in: ids.drives } } });
  await prisma.candidate.deleteMany({ where: { id: { in: ids.candidates } } });
  await prisma.user.deleteMany({ where: { id: { in: [...ids.users, ids.owner] } } });
  await prisma.company.delete({ where: { id: ids.company } });
  await prisma.$disconnect();
});

describe("reliability", () => {
  it("doesn't count a booking on a cancelled or suspended drive as a missed interview", async () => {
    await recomputeReliability(ids.candidates);

    const [attended, onlyCancelled] = await Promise.all(ids.candidates.map((id) => prisma.candidate.findUniqueOrThrow({ where: { id } })));
    expect(attended.reliability).toBe(1);
    // Nothing they booked ever ran, so there is nothing to score.
    expect(onlyCancelled.reliability).toBeNull();
  });
});
