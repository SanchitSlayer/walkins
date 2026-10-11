import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { type AccessTokenPayload, isMessageKey, type MessageKey } from "@walkins/shared";
import type { Request, Response } from "express";
import type { Observable } from "rxjs";
import { apiError } from "./api-error";
import { RateLimiterService } from "./rate-limiter.service";

// Who a limit counts against. "user" and "company" fall back to the address
// for a request with no login. "drive" is the :id in the route.
type Scope = "user" | "company" | "address" | "drive";

export type RateLimitRule = {
  name: string;
  scope: Scope;
  limit: number;
  windowSeconds: number;
};

const RULES_KEY = "rate-limit-rules";

// Several rules may apply to one route; all must pass. A route with none
// gets DEFAULT, so an endpoint added later is never unlimited by omission.
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RULES_KEY, rules);

export const DEFAULT_RULE: RateLimitRule = { name: "default", scope: "user", limit: 600, windowSeconds: 60 };

function subject(scope: Scope, request: Request & { user?: AccessTokenPayload }): string {
  const user = request.user;
  const address = `address:${request.ip ?? "unknown"}`;
  switch (scope) {
    case "user":
      return user ? `user:${user.userId}` : address;
    case "company":
      return user?.companyId ? `company:${user.companyId}` : user ? `user:${user.userId}` : address;
    case "address":
      return address;
    case "drive":
      return `drive:${request.params.id}`;
  }
}


// An interceptor rather than a global guard: Nest runs global guards before
// a controller's JwtAuthGuard, so a guard couldn't yet see who is asking.
@Injectable()
export class RateLimitInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== "http") return next.handle();
    const rules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(RULES_KEY, [context.getHandler(), context.getClass()]) ?? [
      DEFAULT_RULE,
    ];
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: AccessTokenPayload }>();

    for (const rule of rules) {
      const verdict = await this.limiter.consume(`${rule.name}:${subject(rule.scope, request)}`, rule.limit, rule.windowSeconds);
      if (!verdict.allowed) {
        http.getResponse<Response>().setHeader("Retry-After", String(verdict.retryAfterSeconds));
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            ...apiError(isMessageKey(`errors.rateLimited.${rule.name}`) ? (`errors.rateLimited.${rule.name}` as MessageKey) : "errors.rateLimited.default", {
              minutes: Math.ceil(verdict.retryAfterSeconds / 60),
            }),
            retryAfterSeconds: verdict.retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    return next.handle();
  }
}

const MINUTE = 60;
const HOUR = 3600;

// Every limit in one place, with why. Two rules hold throughout:
// - An address is not a person in India. Carrier NAT puts thousands of phones
//   behind one IPv4 address, and a venue's candidates share its Wi-Fi, so a
//   per-address limit is only ever a ceiling on one script. Real limits are
//   per user or per company. Don't tighten the address ones.
// - A limit that blocks a real user is worse than none, so anything a
//   candidate touches is generous: these stop loops and scripts, not people.
export const LIMITS = {
  // Searching, panning the map, opening drives: a venue or a carrier NAT's
  // worth of phones, at a few requests each a minute.
  publicRead: { name: "public-read", scope: "address", limit: 1200, windowSeconds: MINUTE },
  // A real candidate books or releases a handful of seats; retries on a bad
  // signal need room.
  application: { name: "application", scope: "user", limit: 30, windowSeconds: HOUR },
  // Each take is up to 2 MB of storage; twenty re-records is generous.
  voiceUpload: { name: "voice-upload", scope: "user", limit: 20, windowSeconds: HOUR },
  // Desk work, never a burst.
  driveCreate: { name: "drive-create", scope: "user", limit: 20, windowSeconds: HOUR },
  driveCreateCompany: { name: "drive-create", scope: "company", limit: 100, windowSeconds: 24 * HOUR },
  // Editing loops are normal; each save queues an embedding, so a script
  // looping here floods that queue.
  driveEdit: { name: "drive-edit", scope: "user", limit: 60, windowSeconds: HOUR },
  profileEdit: { name: "profile-edit", scope: "user", limit: 60, windowSeconds: HOUR },
  // Bulk "not selected" messages every booked candidate.
  applicantActions: { name: "applicant-actions", scope: "company", limit: 30, windowSeconds: HOUR },
  // Each order opens one at the payment gateway; each confirmation calls it.
  topUpOrder: { name: "top-up-order", scope: "company", limit: 10, windowSeconds: 10 * MINUTE },
  topUpConfirm: { name: "top-up-confirm", scope: "company", limit: 30, windowSeconds: 10 * MINUTE },
  // Public and unauthenticated; Razorpay's own retries stay far below this.
  webhook: { name: "webhook", scope: "address", limit: 300, windowSeconds: MINUTE },
  // The check-in screen asks for a fresh code about once a minute.
  checkInCode: { name: "checkin-code", scope: "drive", limit: 10, windowSeconds: MINUTE },
  // Listening down a shortlist.
  introAudio: { name: "intro-audio", scope: "user", limit: 300, windowSeconds: HOUR },
  telegramLink: { name: "telegram-link", scope: "user", limit: 10, windowSeconds: HOUR },
} satisfies Record<string, RateLimitRule>;
