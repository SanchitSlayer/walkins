import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "@walkins/db";
import type { CandidateProfile, UpdateCandidateProfileInput } from "@walkins/shared";

const REQUIRED_ON_CREATE = ["cityId", "homeLat", "homeLng", "maxTravelKm", "experienceYears", "roleIds"] as const;

@Injectable()
export class CandidatesService {
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
    return (await this.getMe(userId)) as CandidateProfile;
  }

  private toProfile(candidate: { cityId: string; homeLat: number; homeLng: number; maxTravelKm: number; experienceYears: number; roles: { roleId: string }[] }): CandidateProfile {
    return {
      cityId: candidate.cityId,
      homeLat: candidate.homeLat,
      homeLng: candidate.homeLng,
      maxTravelKm: candidate.maxTravelKm,
      experienceYears: candidate.experienceYears,
      roleIds: candidate.roles.map((r) => r.roleId),
    };
  }
}
