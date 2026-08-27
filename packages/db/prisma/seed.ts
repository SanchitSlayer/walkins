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
