import { ForbiddenException } from "@nestjs/common";
import type { AccessTokenPayload } from "@walkins/shared";
import { apiError } from "./api-error";

export function requireCompanyId(user: AccessTokenPayload): string {
  if (!user.companyId) {
    throw new ForbiddenException(apiError("errors.auth.noCompany"));
  }
  return user.companyId;
}
