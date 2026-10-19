// Mirrors the enums in packages/db/prisma/schema.prisma. Kept as plain
// union types (not re-exported from @prisma/client) so apps/web can import
// this package without pulling the Prisma client into the frontend bundle.
export type VerificationStatus = "UNSUBMITTED" | "PENDING" | "VERIFIED" | "REJECTED";

export type UserRole = "CANDIDATE" | "EMPLOYER" | "ADMIN";

// CompanyRole, the second axis, is in people.ts with what each role may do.

export type DriveStatus = "DRAFT" | "PENDING" | "LIVE" | "EXPIRED" | "CANCELLED" | "SUSPENDED";

export type ApplicationState =
  | "INTERESTED"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "INTERVIEWED"
  | "HIRED"
  | "NO_SHOW"
  | "REJECTED"
  | "WITHDRAWN"
  | "SCREENED_OUT";

export type AccessTokenPayload = {
  userId: string;
  role: UserRole;
  companyId: string | null;
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};

export type {
  OtpRequestInput,
  OtpVerifyInput,
  CreateDriveInput,
  UpdateDriveInput,
  DriveSlot,
  DriveSummary,
  DriveDetail,
  EmployerDriveRow,
  DriveSearchResult,
  DriveSearchPage,
  PublicDriveDetail,
} from "../schemas";

export type CandidateProfile = {
  cityId: string;
  homeLat: number;
  homeLng: number;
  maxTravelKm: number;
  experienceYears: number;
  roleIds: string[];
  telegramConnected: boolean;
};
