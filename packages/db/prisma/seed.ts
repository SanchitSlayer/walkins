import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Deterministic PRNG (mulberry32) so the 200-candidate seed is reproducible
// across runs rather than different every time like Math.random() would be.
function mulberry32(seed: number) {
  let state = seed;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CANDIDATE_SEED = 42;

// Named residential areas, not uniform scatter, so radius search clusters
// look realistic in a demo instead of scattering evenly across each city.
const RESIDENTIAL_ANCHORS: Record<string, { name: string; lat: number; lng: number }[]> = {
  Bengaluru: [
    { name: "Whitefield", lat: 12.9698, lng: 77.75 },
    { name: "Koramangala", lat: 12.9352, lng: 77.6146 },
    { name: "Indiranagar", lat: 12.9784, lng: 77.6408 },
    { name: "Electronic City", lat: 12.8452, lng: 77.6602 },
    { name: "Yelahanka", lat: 13.1005, lng: 77.5963 },
  ],
  Pune: [
    { name: "Kothrud", lat: 18.5074, lng: 73.8077 },
    { name: "Hinjewadi", lat: 18.5912, lng: 73.7389 },
    { name: "Viman Nagar", lat: 18.5679, lng: 73.9143 },
    { name: "Kharadi", lat: 18.5515, lng: 73.9345 },
    { name: "Baner", lat: 18.559, lng: 73.7868 },
  ],
  Hyderabad: [
    { name: "Gachibowli", lat: 17.4401, lng: 78.3489 },
    { name: "Kukatpally", lat: 17.4849, lng: 78.4108 },
    { name: "Secunderabad", lat: 17.4399, lng: 78.4983 },
    { name: "Madhapur", lat: 17.4483, lng: 78.3915 },
    { name: "Uppal", lat: 17.3989, lng: 78.559 },
  ],
};

const FIRST_NAMES = [
  "Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan", "Krishna", "Ishaan",
  "Rohan", "Kabir", "Aryan", "Dhruv", "Karthik", "Rahul", "Amit", "Suresh", "Rajesh", "Vikram",
  "Ananya", "Diya", "Saanvi", "Aadhya", "Kiara", "Myra", "Sara", "Ira", "Anika", "Riya",
  "Priya", "Neha", "Pooja", "Sneha", "Kavya", "Shreya", "Divya", "Meera", "Lakshmi", "Deepika",
];

const LAST_NAMES = [
  "Sharma", "Verma", "Gupta", "Kumar", "Singh", "Patel", "Reddy", "Rao", "Nair", "Iyer",
  "Menon", "Pillai", "Naidu", "Chowdary", "Joshi", "Desai", "Mehta", "Shah", "Kulkarni", "Deshmukh",
];

// Jitter biased toward the anchor's center (random()**2) so density falls
// off with distance like a real residential cluster, capped at ~3km radius.
function jitterAround(random: () => number, centerLat: number, centerLng: number, maxKm = 3) {
  const angle = random() * 2 * Math.PI;
  const radiusKm = maxKm * random() ** 2;
  const dLat = (radiusKm / 111) * Math.cos(angle);
  const dLng = (radiusKm / (111 * Math.cos((centerLat * Math.PI) / 180))) * Math.sin(angle);
  return { lat: centerLat + dLat, lng: centerLng + dLng };
}

function shuffle<T>(random: () => number, items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const cities = [
  { name: "Bengaluru", state: "Karnataka", centerLat: 12.9716, centerLng: 77.5946 },
  { name: "Pune", state: "Maharashtra", centerLat: 18.5204, centerLng: 73.8567 },
  { name: "Hyderabad", state: "Telangana", centerLat: 17.385, centerLng: 78.4867 },
];

const roles = [
  { title: "Telecaller", slug: "telecaller" },
  { title: "Delivery Executive", slug: "delivery-executive" },
  { title: "Field Sales Executive", slug: "field-sales-executive" },
  { title: "Warehouse Associate", slug: "warehouse-associate" },
  { title: "Customer Support Executive", slug: "customer-support-executive" },
];

async function main() {
  for (const city of cities) {
    const existing = await prisma.city.findFirst({ where: { name: city.name, state: city.state } });
    if (!existing) {
      await prisma.city.create({ data: city });
    }
  }

  for (const role of roles) {
    await prisma.role.upsert({
      where: { slug: role.slug },
      update: {},
      create: role,
    });
  }

  // OTP verify only ever creates CANDIDATE users for a new phone (the
  // {phone, otp} payload has no role field by design), so there is no
  // self-serve path to an EMPLOYER account yet. Seed one test employer,
  // scoped to a real company, so the drive CRUD endpoints are reachable.
  const bengaluru = await prisma.city.findFirstOrThrow({ where: { name: "Bengaluru" } });

  const testCompany = await prisma.company.findFirst({ where: { name: "Test Company" } });
  const company =
    testCompany ??
    (await prisma.company.create({
      data: {
        name: "Test Company",
        verificationStatus: "VERIFIED",
        contactPhone: "9999999999",
        cityId: bengaluru.id,
      },
    }));

  const employerPhone = "9999999999";
  const existingEmployer = await prisma.user.findUnique({ where: { phone: employerPhone } });
  if (!existingEmployer) {
    await prisma.user.create({
      data: { phone: employerPhone, name: "Test Employer", role: "EMPLOYER", companyId: company.id },
    });
  }

  const seededCandidateCount = await prisma.user.count({ where: { phone: { startsWith: "70" }, role: "CANDIDATE" } });
  if (seededCandidateCount < 200) {
    const random = mulberry32(CANDIDATE_SEED);
    const cityNames = Object.keys(RESIDENTIAL_ANCHORS);
    const cityRows = await prisma.city.findMany({ where: { name: { in: cityNames } } });
    const cityByName = new Map(cityRows.map((c) => [c.name, c]));
    const roleRows = await prisma.role.findMany({ where: { slug: { in: roles.map((r) => r.slug) } } });

    const users: { id: string; phone: string; name: string; role: "CANDIDATE" }[] = [];
    const candidateRows: {
      id: string;
      userId: string;
      cityId: string;
      homeLat: number;
      homeLng: number;
      maxTravelKm: number;
      experienceYears: number;
    }[] = [];
    const candidateRoleRows: { candidateId: string; roleId: string }[] = [];

    for (let i = 0; i < 200; i++) {
      const cityName = cityNames[i % cityNames.length];
      const city = cityByName.get(cityName)!;
      const anchors = RESIDENTIAL_ANCHORS[cityName];
      const anchor = anchors[Math.floor(random() * anchors.length)];
      const point = jitterAround(random, anchor.lat, anchor.lng);

      const firstName = FIRST_NAMES[Math.floor(random() * FIRST_NAMES.length)];
      const lastName = LAST_NAMES[Math.floor(random() * LAST_NAMES.length)];
      const userId = `seed_user_${i}`;
      const candidateId = `seed_cand_${i}`;

      users.push({
        id: userId,
        phone: `70${String(i).padStart(8, "0")}`,
        name: `${firstName} ${lastName}`,
        role: "CANDIDATE",
      });

      candidateRows.push({
        id: candidateId,
        userId,
        cityId: city.id,
        homeLat: point.lat,
        homeLng: point.lng,
        maxTravelKm: Math.round(3 + random() * 22),
        experienceYears: Math.round(random() * 8 * 10) / 10,
      });

      const roleCount = 1 + Math.floor(random() * 3);
      for (const role of shuffle(random, roleRows).slice(0, roleCount)) {
        candidateRoleRows.push({ candidateId, roleId: role.id });
      }
    }

    await prisma.user.createMany({ data: users, skipDuplicates: true });
    await prisma.candidate.createMany({ data: candidateRows, skipDuplicates: true });
    await prisma.candidateRole.createMany({ data: candidateRoleRows, skipDuplicates: true });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
