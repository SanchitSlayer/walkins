import { CanActivate, type ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AccessTokenPayload, UserRole } from "@walkins/shared";
import { apiError } from "./api-error";
import { ROLES_KEY } from "./roles.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: AccessTokenPayload | undefined = request.user;

    // Nest's own refusal says "Forbidden resource".
    if (!user || !requiredRoles.includes(user.role)) throw new ForbiddenException(apiError("errors.auth.wrongRole"));
    return true;
  }
}
