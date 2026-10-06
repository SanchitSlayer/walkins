import { PrismaClient } from "@prisma/client";
import { phoneSchema } from "@walkins/shared";

// pnpm admin:create <phone> <name>
//
// The only way to make an ADMIN. Sign-in creates candidates and the seed
// creates one employer; neither path can produce an admin, on purpose. Run it
// once per admin, against whichever database DATABASE_URL points at. It
// refuses to turn an existing candidate or employer into an admin: that
// account's history belongs to its role.
const prisma = new PrismaClient();

async function main() {
  const [phoneArg, ...nameParts] = process.argv.slice(2);
  const phone = phoneSchema.safeParse(phoneArg);
  const name = nameParts.join(" ").trim();
  if (!phone.success || !name) {
    console.error("Usage: pnpm admin:create <10-digit phone> <name>");
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.user.findUnique({ where: { phone: phone.data } });
  if (existing?.role === "ADMIN") {
    console.log(`${phone.data} is already an admin (${existing.name}). Nothing changed.`);
    return;
  }
  if (existing) {
    console.error(`${phone.data} belongs to a ${existing.role.toLowerCase()} account. Use a different phone for the admin.`);
    process.exitCode = 1;
    return;
  }
  await prisma.user.create({ data: { phone: phone.data, name, role: "ADMIN" } });
  console.log(`Created admin ${name} (${phone.data}). Sign in with that phone; /admin is the panel.`);
}

main().finally(() => prisma.$disconnect());
