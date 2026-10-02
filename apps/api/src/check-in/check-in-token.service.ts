import { randomBytes, randomUUID } from "node:crypto";
import { BadRequestException, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { CHECKIN_CODE_ALPHABET, CHECKIN_CODE_LENGTH, normalizeCheckInCode } from "@walkins/shared";
import { redis } from "../common/redis";

const AUDIENCE = "checkin";
export const CHECKIN_TOKEN_TTL_SECONDS = 90;
export const CHECKIN_TOKEN_ROTATE_SECONDS = 60;
// An offline scan syncs after its code has expired. Within this window it is
// accepted and flagged for the employer, since the server can't tell a phone
// that lost signal from a code that was photographed and forwarded.
export const OFFLINE_GRACE_MS = 30 * 60_000;

// A code must still resolve when a scan queued offline finally syncs, so it
// lives for the token's lifetime plus the grace; the token's own expiry, not
// the code's, decides whether the scan was on time or late and flagged.
const CODE_TTL_SECONDS = CHECKIN_TOKEN_TTL_SECONDS + OFFLINE_GRACE_MS / 1000;

export function checkInCodeKey(code: string) {
  return `checkin-code:${code}`;
}

// 256 is a multiple of 32, so taking each random byte modulo 32 picks every
// character with equal probability.
function randomCode(): string {
  return [...randomBytes(CHECKIN_CODE_LENGTH)].map((byte) => CHECKIN_CODE_ALPHABET[byte % 32]).join("");
}

// Check-in tokens get their own secret and an audience, so nothing else that
// trusts JWT_SECRET (JwtAuthGuard accepts anything it signed) could accept
// one. The token itself stays on the server: the screen shows a short code
// that resolves to it.
function checkInSecret(): string {
  const secret = process.env.CHECKIN_JWT_SECRET;
  if (!secret) throw new Error("CHECKIN_JWT_SECRET is not set");
  if (secret === process.env.JWT_SECRET) {
    throw new Error("CHECKIN_JWT_SECRET must differ from JWT_SECRET, or a check-in token would work as a login");
  }
  return secret;
}

export type VerifiedCheckInToken = { driveId: string; jti: string; expiresAt: Date };

@Injectable()
export class CheckInTokenService {
  private readonly jwt = new JwtService({ secret: checkInSecret() });

  async issueCode(driveId: string): Promise<{ code: string; expiresAt: Date }> {
    const token = this.jwt.sign(
      { driveId },
      { audience: AUDIENCE, jwtid: randomUUID(), expiresIn: CHECKIN_TOKEN_TTL_SECONDS },
    );
    const expiresAt = new Date(Date.now() + CHECKIN_TOKEN_TTL_SECONDS * 1000);
    // Set only if absent: a collision, vanishingly rare at 40 bits, draws again
    // rather than overwriting another drive's live code.
    for (;;) {
      const code = randomCode();
      if ((await redis.set(checkInCodeKey(code), token, "EX", CODE_TTL_SECONDS, "NX")) === "OK") {
        return { code, expiresAt };
      }
    }
  }

  // Null when the input can't be a code or no longer resolves.
  async resolve(input: string): Promise<VerifiedCheckInToken | null> {
    const code = normalizeCheckInCode(input);
    if (!code) return null;
    const token = await redis.get(checkInCodeKey(code));
    return token ? this.verify(token) : null;
  }

  // Signature and audience only: expiry is the caller's decision, because an
  // offline scan legitimately arrives after its token has expired.
  private verify(token: string): VerifiedCheckInToken {
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
