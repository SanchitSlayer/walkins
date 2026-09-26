import { CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { AccessTokenPayload } from "@walkins/shared";

// Unlike JwtAuthGuard, a missing or invalid token is not an error here —
// req.user is simply left undefined, and the route decides what to default
// to (e.g. public drive search falling back to a city's center point).
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

    if (token) {
      try {
        request.user = this.jwtService.verify<AccessTokenPayload>(token);
      } catch {
        // Invalid/expired token on a public route: treat as anonymous rather than rejecting.
      }
    }

    return true;
  }
}
