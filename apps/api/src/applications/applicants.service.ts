import { Injectable, NotFoundException } from "@nestjs/common";
import { type ApplicationState, prisma, StaleTransitionError, IllegalTransitionError, transitionApplication } from "@walkins/db";
import {
  type Applicant,
  type Applicants,
  applicantsSchema,
  type ApplicantsAction,
  evaluateKnockouts,
  type KnockoutAnswers,
  type MessageKey,
  knockoutQuestionsSchema,
  MAX_TRAVEL_KM,
  transcriptConfidence,
} from "@walkins/shared";
import { JobsService } from "../common/jobs.service";
import { StorageService } from "../common/storage.service";
import { LiveGateway } from "../live/live.gateway";
import { apiError } from "../common/api-error";
import { personRef, requireCompanyAccess, requireNotSuspended } from "../common/require-company";

type Row = {
  applicationId: string;
  candidateId: string;
  candidateName: string;
  state: ApplicationState;
  slotStartsAt: Date | null;
  shortlisted: boolean;
  shortlistedById: string | null;
  shortlistedByName: string | null;
  shortlistedByCompanyId: string | null;
  distanceKm: number;
  experienceYears: number;
  screenedOutReason: string | null;
  knockoutAnswers: KnockoutAnswers | null;
  similarity: number | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

@Injectable()
export class ApplicantsService {
  constructor(
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
    private readonly live: LiveGateway,
  ) {}

  // Rank = weight × semantic similarity + (1 − weight) × distance score, so
  // weight 0 is the phase 3 rule (nearest first) and 1 is meaning alone.
  // Similarity is cosine, via pgvector's <=> (cosine distance) on unit
  // vectors. Someone with no embedding yet takes the drive's median
  // similarity, so a missing intro neither lifts nor sinks them, and the row
  // says it was ranked by distance only.
  async list(userId: string, driveId: string, weight: number): Promise<Applicants> {
    const { companyId } = await requireCompanyAccess(userId, "read");
    const drive = await prisma.drive.findFirst({
      where: { id: driveId, companyId },
      select: { knockoutQuestions: true, company: { select: { readsLanguages: true } } },
    });
    if (!drive) throw new NotFoundException(apiError("errors.drive.notFound"));

    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        a.id AS "applicationId",
        c.id AS "candidateId",
        u.name AS "candidateName",
        a.state,
        s."startsAt" AS "slotStartsAt",
        a."shortlistedAt" IS NOT NULL AS shortlisted,
        sb.id AS "shortlistedById",
        sb.name AS "shortlistedByName",
        sb."companyId" AS "shortlistedByCompanyId",
        ST_Distance(c.geom, d.geom) / 1000 AS "distanceKm",
        c."experienceYears",
        a."screenedOutReason",
        a."knockoutAnswers",
        CASE WHEN c.embedding IS NOT NULL AND d.embedding IS NOT NULL
          THEN 1 - (c.embedding <=> d.embedding) END AS similarity
      FROM applications a
      JOIN candidates c ON c.id = a."candidateId"
      JOIN users u ON u.id = c."userId"
      JOIN drives d ON d.id = a."driveId"
      LEFT JOIN drive_slots s ON s.id = a."slotId"
      LEFT JOIN users sb ON sb.id = a."shortlistedById"
      WHERE a."driveId" = ${driveId} AND a.state <> 'WITHDRAWN'
    `;

    const intros = await prisma.voiceIntro.findMany({
      where: { candidateId: { in: rows.map((r) => r.candidateId) }, replacedAt: null },
      orderBy: { createdAt: "desc" },
    });
    const introByCandidate = new Map<string, (typeof intros)[number]>();
    for (const intro of intros) if (!introByCandidate.has(intro.candidateId)) introByCandidate.set(intro.candidateId, intro);

    const questions = knockoutQuestionsSchema.parse(drive.knockoutQuestions);
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
    const medianSimilarity = median(rows.flatMap((r) => (r.similarity === null ? [] : [clamp(r.similarity)])));

    const applicants: Applicant[] = rows.map((row) => {
      const distanceScore = clamp(1 - row.distanceKm / MAX_TRAVEL_KM);
      const similarity = row.similarity === null ? null : clamp(row.similarity);
      const stands = similarity ?? medianSimilarity ?? distanceScore;
      const intro = introByCandidate.get(row.candidateId);
      return {
        applicationId: row.applicationId,
        candidateName: row.candidateName,
        state: row.state,
        slotStartsAt: row.slotStartsAt?.toISOString() ?? null,
        shortlisted: row.shortlisted,
        shortlistedBy:
          row.shortlisted && row.shortlistedById && row.shortlistedByName
            ? personRef({ id: row.shortlistedById, name: row.shortlistedByName, companyId: row.shortlistedByCompanyId }, companyId)
            : null,
        distanceKm: row.distanceKm,
        experienceYears: row.experienceYears,
        screenedOutReason: row.screenedOutReason,
        knockout: questions.map((q) => ({
          prompt: q.prompt,
          // The raw answer; the page words it in the reader's language.
          answer: row.knockoutAnswers?.[q.id] ?? null,
          met: evaluateKnockouts([q], row.knockoutAnswers ?? {}).passed,
        })),
        match: {
          score: weight * stands + (1 - weight) * distanceScore,
          distanceScore,
          similarity,
          basis: similarity === null ? "distance_only" : "semantic",
        },
        intro: intro
          ? {
              status: intro.status,
              transcript: intro.transcript,
              language: intro.language,
              languageProbability: intro.languageProbability,
              durationSeconds: intro.durationSeconds,
              confidence: intro.status === "DONE" ? transcriptConfidence(intro) : null,
              error: intro.error,
              hasAudio: true,
            }
          : null,
      };
    });

    // Screened-out applicants stay visible, with their answers, but below
    // everyone the employer could still book.
    applicants.sort(
      (a, b) => Number(a.state === "SCREENED_OUT") - Number(b.state === "SCREENED_OUT") || b.match.score - a.match.score,
    );
    return applicantsSchema.parse({
      driveId,
      weight,
      medianSimilarity,
      readsLanguages: drive.company.readsLanguages,
      applicants,
    });
  }

  async act(userId: string, driveId: string, { applicationIds, action }: ApplicantsAction) {
    const { companyId } = await requireCompanyAccess(userId, "runDrives");
    const drive = await prisma.drive.findFirst({ where: { id: driveId, companyId }, select: { status: true } });
    if (drive) requireNotSuspended(drive);
    const owned = await prisma.application.findMany({
      where: { id: { in: applicationIds }, driveId, drive: { companyId } },
      select: { id: true, candidateId: true, state: true },
    });
    // Each skip carries a catalog key, worded by the page in its language.
    const skipped: { applicationId: string; code: MessageKey }[] = applicationIds
      .filter((id) => !owned.some((a) => a.id === id))
      .map((applicationId) => ({ applicationId, code: "errors.application.notApplicant" as const }));

    if (action !== "reject") {
      // A private note for the employer, so it sits beside the state rather
      // than being one: it doesn't change what the candidate sees. Audited,
      // so a shared shortlist still says who put each person on it.
      await prisma.$transaction([
        prisma.application.updateMany({
          where: { id: { in: owned.map((a) => a.id) } },
          data: action === "shortlist" ? { shortlistedAt: new Date(), shortlistedById: userId } : { shortlistedAt: null, shortlistedById: null },
        }),
        prisma.auditLog.createMany({
          data: owned.map((a) => ({
            actorUserId: userId,
            entityType: "application",
            entityId: a.id,
            action: action === "shortlist" ? "shortlisted" : "unshortlisted",
          })),
        }),
      ]);
      return { updated: owned.length, skipped };
    }

    let updated = 0;
    for (const application of owned) {
      try {
        await prisma.$transaction((tx) =>
          transitionApplication(tx, { applicationId: application.id, to: "REJECTED", actor: { kind: "employer", userId } }),
        );
        updated += 1;
        // Someone booked but not yet here is told, so they don't travel to a
        // drive that no longer wants them; their seat is free again.
        if (application.state === "CONFIRMED") {
          await this.jobs.alert({ driveId, candidateId: application.candidateId, templateKey: "application_rejected" });
        }
      } catch (err) {
        if (!(err instanceof IllegalTransitionError || err instanceof StaleTransitionError)) throw err;
        skipped.push({
          applicationId: application.id,
          code: err instanceof StaleTransitionError ? "errors.application.stale" : "errors.application.illegal",
        });
      }
    }
    await this.live.publish(driveId);
    return { updated, skipped };
  }

  async introAudio(userId: string, applicationId: string): Promise<{ url: string }> {
    const { companyId } = await requireCompanyAccess(userId, "read");
    const application = await prisma.application.findFirst({
      where: { id: applicationId, drive: { companyId } },
      select: { candidateId: true },
    });
    if (!application) throw new NotFoundException(apiError("errors.application.notFound"));
    const intro = await prisma.voiceIntro.findFirst({
      where: { candidateId: application.candidateId, replacedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!intro) throw new NotFoundException(apiError("errors.voice.noRecording"));
    return { url: await this.storage.presignPlayback(intro.objectKey) };
  }
}
