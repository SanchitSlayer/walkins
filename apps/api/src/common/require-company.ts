import { ForbiddenException } from "@nestjs/common";
import { prisma } from "@walkins/db";
import { type CompanyPermission, type CompanyRole, companyCan, type PersonRef } from "@walkins/shared";
import { apiError } from "./api-error";

export type CompanyAccess = { companyId: string; companyName: string; role: CompanyRole };

// Every employer request starts here, in the service. It reads the person's
// company and role from the database rather than the access token, so
// removing someone or changing their role holds from their next request,
// not from whenever their token expires.
export async function requireCompanyAccess(userId: string, permission: CompanyPermission): Promise<CompanyAccess> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { companyRole: true, company: { select: { id: true, name: true, suspendedAt: true } } },
  });
  if (!user?.company || !user.companyRole) {
    throw new ForbiddenException(apiError("errors.auth.noCompany"));
  }
  // A suspended company can still see everything it has, and change nothing.
  if (user.company.suspendedAt && permission !== "read") {
    throw new ForbiddenException(apiError("errors.people.companySuspended", { company: user.company.name }));
  }
  if (!companyCan(user.companyRole, permission)) {
    throw new ForbiddenException(apiError(`errors.people.cannot.${permission}`, { company: user.company.name }));
  }
  return { companyId: user.company.id, companyName: user.company.name, role: user.companyRole };
}

export const PERSON_SELECT = { id: true, name: true, companyId: true } as const;

// A person named on one of a company's records. Their name stays after they
// leave, marked as no longer current, so the record still says who did it.
export function personRef(user: { id: string; name: string; companyId: string | null }, companyId: string): PersonRef {
  return { userId: user.id, name: user.name, current: user.companyId === companyId };
}

// A suspended drive's desk is read-only: nothing on it can be confirmed,
// charged or moved on while Walkins looks at it.
export function requireNotSuspended(drive: { status: string }) {
  if (drive.status === "SUSPENDED") throw new ForbiddenException(apiError("errors.drive.suspendedDesk"));
}
