// Mirrors the enums in packages/db/prisma/schema.prisma. Kept as plain
// union types (not re-exported from @prisma/client) so apps/web can import
// this package without pulling the Prisma client into the frontend bundle.
export type VerificationStatus = "PENDING" | "VERIFIED" | "REJECTED";

export type UserRole = "CANDIDATE" | "EMPLOYER" | "ADMIN";

export type DriveStatus = "DRAFT" | "PENDING" | "LIVE" | "EXPIRED" | "CANCELLED";

export type ApplicationState =
  | "INTERESTED"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "INTERVIEWED"
  | "HIRED"
  | "NO_SHOW"
  | "REJECTED";
