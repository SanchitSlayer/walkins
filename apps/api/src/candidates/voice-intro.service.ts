import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma, type VoiceIntro as VoiceIntroRow } from "@walkins/db";
import {
  transcriptConfidence,
  VOICE_MAX_BYTES,
  type VoiceContentType,
  type VoiceIntro,
  voiceIntroSchema,
  type VoiceUpload,
  voiceUploadSchema,
} from "@walkins/shared";
import { JobsService } from "../common/jobs.service";
import { redis } from "../common/redis";
import { StorageService } from "../common/storage.service";

const EXTENSION: Record<VoiceContentType, string> = { "audio/webm": "webm", "audio/mp4": "m4a", "audio/ogg": "ogg" };
// An upload that isn't confirmed within this long never becomes an intro;
// its object is left for the bucket's own cleanup.
const PENDING_SECONDS = 15 * 60;

function pendingKey(introId: string) {
  return `voice-upload:${introId}`;
}

type Pending = { candidateId: string; objectKey: string; contentType: VoiceContentType };

export function toVoiceIntro(row: VoiceIntroRow): VoiceIntro {
  return voiceIntroSchema.parse({
    id: row.id,
    status: row.status,
    transcript: row.transcript,
    language: row.language,
    languageProbability: row.languageProbability,
    durationSeconds: row.durationSeconds,
    confidence: row.status === "DONE" ? transcriptConfidence(row) : null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    processedAt: row.processedAt?.toISOString() ?? null,
  });
}

@Injectable()
export class VoiceIntroService {
  constructor(
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
  ) {}

  async startUpload(userId: string, contentType: VoiceContentType): Promise<VoiceUpload> {
    const candidate = await this.requireCandidate(userId);
    const introId = randomUUID();
    const pending: Pending = {
      candidateId: candidate.id,
      objectKey: `voice-intros/${candidate.id}/${introId}.${EXTENSION[contentType]}`,
      contentType,
    };
    await redis.set(pendingKey(introId), JSON.stringify(pending), "EX", PENDING_SECONDS);
    const { url, fields } = await this.storage.presignUpload(pending.objectKey, contentType, VOICE_MAX_BYTES);
    return voiceUploadSchema.parse({ introId, url, fields, maxBytes: VOICE_MAX_BYTES });
  }

  // Only now does the intro exist: the upload went straight to storage, so
  // the server checks it actually arrived before queueing it.
  async completeUpload(userId: string, introId: string): Promise<VoiceIntro> {
    const candidate = await this.requireCandidate(userId);
    const raw = await redis.get(pendingKey(introId));
    const pending: Pending | null = raw ? JSON.parse(raw) : null;
    if (!pending || pending.candidateId !== candidate.id) {
      throw new NotFoundException("That recording has expired. Record it again.");
    }
    if ((await this.storage.size(pending.objectKey)) === null) {
      throw new BadRequestException("The recording didn't finish uploading. Try again.");
    }

    // The previous intro is replaced, not deleted here: the nightly
    // maintenance job removes replaced recordings and their transcripts.
    const intro = await prisma.$transaction(async (tx) => {
      await tx.voiceIntro.updateMany({ where: { candidateId: candidate.id, replacedAt: null }, data: { replacedAt: new Date() } });
      return tx.voiceIntro.create({
        data: { id: introId, candidateId: candidate.id, objectKey: pending.objectKey, contentType: pending.contentType },
      });
    });
    await redis.del(pendingKey(introId));
    await this.jobs.transcribe({ introId });
    return toVoiceIntro(intro);
  }

  async current(userId: string): Promise<VoiceIntro | null> {
    const candidate = await this.requireCandidate(userId);
    const intro = await prisma.voiceIntro.findFirst({
      where: { candidateId: candidate.id, replacedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return intro ? toVoiceIntro(intro) : null;
  }

  private async requireCandidate(userId: string) {
    const candidate = await prisma.candidate.findUnique({ where: { userId }, select: { id: true } });
    if (!candidate) throw new BadRequestException("Save your profile before recording an intro");
    return candidate;
  }
}
