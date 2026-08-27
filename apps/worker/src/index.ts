import { prisma } from "@walkins/db";
import { connection } from "./redis";

connection.on("connect", () => {
  console.log("worker: connected to redis");
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  connection.disconnect();
  process.exit(0);
});
