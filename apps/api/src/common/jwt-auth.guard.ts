import { CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { AccessTokenPayload } from "@walkins/shared";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

    if (!token) {
      throw new UnauthorizedException("Missing access token");
    }

    try {
      request.user = this.jwtService.verify<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }

    return true;
  }
}
