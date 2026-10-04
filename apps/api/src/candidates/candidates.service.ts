import { randomBytes } from "node:crypto";
import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { prisma } from "@walkins/db";
import {
  type CandidateProfile,
  TELEGRAM_LINK_TTL_SECONDS,
  type TelegramLink,
  telegramLinkKey,
  telegramLinkSchema,
  type UpdateCandidateProfileInput,
} from "@walkins/shared";
import { JobsService } from "../common/jobs.service";
import { redis } from "../common/redis";

const REQUIRED_ON_CREATE = ["cityId", "homeLat", "homeLng", "maxTravelKm", "experienceYears", "roleIds"] as const;

@Injectable()
export class CandidatesService {
  constructor(private readonly jobs: JobsService) {}

  async getMe(userId: string): Promise<CandidateProfile | null> {
    const candidate = await prisma.candidate.findUnique({
      where: { userId },
      include: { roles: { select: { roleId: true } } },
    });
    if (!candidate) {
      return null;
    }
    return this.toProfile(candidate);
  }

  async updateMe(userId: string, input: UpdateCandidateProfileInput): Promise<CandidateProfile> {
    const existing = await prisma.candidate.findUnique({ where: { userId } });

    if (!existing) {
      const missing = REQUIRED_ON_CREATE.filter((field) => input[field] === undefined);
      if (missing.length > 0) {
        throw new BadRequestException(`A first save must include: ${missing.join(", ")}`);
      }
    }

    const { roleIds, ...profileFields } = input;

    await prisma.$transaction(async (tx) => {
      const saved = existing
        ? await tx.candidate.update({ where: { userId }, data: profileFields })
        : await tx.candidate.create({
            data: {
              userId,
              cityId: input.cityId!,
              homeLat: input.homeLat!,
              homeLng: input.homeLng!,
              maxTravelKm: input.maxTravelKm!,
              experienceYears: input.experienceYears!,
            },
          });

      if (roleIds) {
        await tx.candidateRole.deleteMany({ where: { candidateId: saved.id } });
        await tx.candidateRole.createMany({ data: roleIds.map((roleId) => ({ candidateId: saved.id, roleId })) });
      }
    });

    // getMe never returns null here: we just created or updated this exact row.
    // Roles, experience and city feed the candidate's embedding, so any save
    // can change it; the worker rebuilds it from the saved row.
    const profile = (await this.getMe(userId)) as CandidateProfile;
    const { id } = await prisma.candidate.findUniqueOrThrow({ where: { userId }, select: { id: true } });
    await this.jobs.reembed({ kind: "candidate", id });
    return profile;
  }

  // The token is the only thing tying a Telegram chat to this account, so it
  // is random, single use (the bot deletes it on /start) and short-lived.
  async createTelegramLink(userId: string): Promise<TelegramLink> {
    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    if (!botUsername) {
      throw new ServiceUnavailableException("Telegram isn't configured on this server");
    }
    const candidate = await prisma.candidate.findUnique({ where: { userId }, select: { id: true } });
    if (!candidate) {
      throw new BadRequestException("Save your profile before connecting Telegram");
    }

    // base64url stays inside the characters Telegram allows in a start parameter.
    const token = randomBytes(24).toString("base64url");
    await redis.set(telegramLinkKey(token), candidate.id, "EX", TELEGRAM_LINK_TTL_SECONDS);
    return telegramLinkSchema.parse({
      token,
      deepLink: `https://t.me/${botUsername}?start=${token}`,
      expiresInSeconds: TELEGRAM_LINK_TTL_SECONDS,
    });
  }

  private toProfile(candidate: {
    cityId: string;
    homeLat: number;
    homeLng: number;
    maxTravelKm: number;
    experienceYears: number;
    telegramChatId: string | null;
    roles: { roleId: string }[];
  }): CandidateProfile {
    return {
      cityId: candidate.cityId,
      homeLat: candidate.homeLat,
      homeLng: candidate.homeLng,
      maxTravelKm: candidate.maxTravelKm,
      experienceYears: candidate.experienceYears,
      roleIds: candidate.roles.map((r) => r.roleId),
      telegramConnected: candidate.telegramChatId !== null,
    };
  }
}
