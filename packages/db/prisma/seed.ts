import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
