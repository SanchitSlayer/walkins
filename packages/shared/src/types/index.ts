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

export type AccessTokenPayload = {
  userId: string;
  role: UserRole;
  companyId: string | null;
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type { OtpRequestInput, OtpVerifyInput, CreateDriveInput, UpdateDriveInput } from "../schemas";

// Moved here from apps/web (rather than duplicated) because public search
// results need the same shape plus distanceKm, and are fetched both
// client-side and during SSR — not just through the browser-only api client.
export type DriveSummary = {
  id: string;
  roleId: string;
  cityId: string;
  salaryMin: number;
  salaryMax: number;
  venueAddress: string;
  venueLat: number;
  venueLng: number;
  startsAt: string;
  endsAt: string;
  capacity: number;
  experienceMin: number;
  experienceMax: number;
  status: DriveStatus;
  needsManualGeocode: boolean;
  role: { title: string; slug: string };
};

export type DriveDetail = DriveSummary & {
  slots: { id: string; startsAt: string; capacity: number; bookedCount: number }[];
};

export type DriveSearchResult = DriveSummary & {
  distanceKm: number;
  city: { name: string; state: string };
};

export type CandidateProfile = {
  cityId: string;
  homeLat: number;
  homeLng: number;
  maxTravelKm: number;
  experienceYears: number;
  roleIds: string[];
};
