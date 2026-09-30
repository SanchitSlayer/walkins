import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";

const AUDIENCE = "checkin";
export const CHECKIN_TOKEN_TTL_SECONDS = 90;
export const CHECKIN_TOKEN_ROTATE_SECONDS = 60;

// The QR is on public display, so it must never be a token that anything
// else accepts. The global JwtModule signs access tokens with JWT_SECRET and
// JwtAuthGuard accepts anything that secret signed, so check-in tokens get
// their own secret, plus an audience check on the way back in.
function checkInSecret(): string {
  const secret = process.env.CHECKIN_JWT_SECRET;
  if (!secret) throw new Error("CHECKIN_JWT_SECRET is not set");
  if (secret === process.env.JWT_SECRET) {
    throw new Error("CHECKIN_JWT_SECRET must differ from JWT_SECRET, or a displayed check-in code would work as a login");
  }
  return secret;
}

export type VerifiedCheckInToken = { driveId: string; jti: string; expiresAt: Date };

@Injectable()
export class CheckInTokenService {
  private readonly jwt = new JwtService({ secret: checkInSecret() });

  issue(driveId: string): { token: string; expiresAt: Date } {
    const token = this.jwt.sign(
      { driveId },
      { audience: AUDIENCE, jwtid: randomUUID(), expiresIn: CHECKIN_TOKEN_TTL_SECONDS },
    );
    return { token, expiresAt: new Date(Date.now() + CHECKIN_TOKEN_TTL_SECONDS * 1000) };
  }

  // Signature and audience only: expiry is the caller's decision, because an
  // offline scan legitimately arrives after its token has expired.
  verify(token: string): VerifiedCheckInToken {
    try {
      const payload = this.jwt.verify<{ driveId: string; jti: string; exp: number }>(token, {
        audience: AUDIENCE,
        ignoreExpiration: true,
      });
      return { driveId: payload.driveId, jti: payload.jti, expiresAt: new Date(payload.exp * 1000) };
    } catch {
      throw new BadRequestException("That isn't a Walkins check-in code");
    }
  }
}
