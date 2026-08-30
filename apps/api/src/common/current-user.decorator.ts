import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AccessTokenPayload } from "@walkins/shared";

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AccessTokenPayload => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
