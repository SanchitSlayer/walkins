import { ForbiddenException } from "@nestjs/common";
import type { AccessTokenPayload } from "@walkins/shared";

export function requireCompanyId(user: AccessTokenPayload): string {
  if (!user.companyId) {
    throw new ForbiddenException("This account is not linked to a company");
  }
  return user.companyId;
}
