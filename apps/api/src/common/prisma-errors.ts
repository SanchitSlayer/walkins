import { Prisma } from "@walkins/db";

// A unique constraint rejected the write: the row it would have created
// already exists, usually because a concurrent request made it first.
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
