// Runs before every test file, so before anything constructs the Prisma
// client. Tests commit ledger rows that can never be deleted, and run
// maintenance functions that act on whole tables, so they must never reach
// the database real data lives in.
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || testUrl === process.env.DATABASE_URL) {
  throw new Error("Set TEST_DATABASE_URL to a separate database (pnpm test:db creates it); tests never run against DATABASE_URL");
}
process.env.DATABASE_URL = testUrl;
