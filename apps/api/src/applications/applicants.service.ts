import { Injectable, NotFoundException } from "@nestjs/common";
import { type ApplicationState, prisma, StaleTransitionError, IllegalTransitionError, transitionApplication } from "@walkins/db";
import {
  type Applicant,
  type Applicants,
  applicantsSchema,
  type ApplicantsAction,
  evaluateKnockouts,
  type KnockoutAnswers,
  knockoutQuestionsSchema,
  MAX_TRAVEL_KM,
  transcriptConfidence,
} from "@walkins/shared";
import { JobsService } from "../common/jobs.service";
import { StorageService } from "../common/storage.service";
import { LiveGateway } from "../live/live.gateway";

type Row = {
  applicationId: string;
  candidateId: string;
  candidateName: string;
  state: ApplicationState;
  slotStartsAt: Date | null;
  shortlisted: boolean;
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

function showAnswer(answer: KnockoutAnswers[string] | undefined): string {
  if (answer === undefined) return "No answer";
  if (typeof answer === "boolean") return answer ? "Yes" : "No";
  return String(answer);
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
  async list(companyId: string, driveId: string, weight: number): Promise<Applicants> {
    const drive = await prisma.drive.findFirst({
      where: { id: driveId, companyId },
      select: { knockoutQuestions: true, company: { select: { readsLanguages: true } } },
    });
    if (!drive) throw new NotFoundException("Drive not found");

    const rows = await prisma.$queryRaw<Row[]>`
      SELECT
        a.id AS "applicationId",
        c.id AS "candidateId",
        u.name AS "candidateName",
        a.state,
        s."startsAt" AS "slotStartsAt",
        a."shortlistedAt" IS NOT NULL AS shortlisted,
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
        distanceKm: row.distanceKm,
        experienceYears: row.experienceYears,
        screenedOutReason: row.screenedOutReason,
        knockout: questions.map((q) => ({
          prompt: q.prompt,
          answer: showAnswer(row.knockoutAnswers?.[q.id]),
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

  async act(companyId: string, userId: string, driveId: string, { applicationIds, action }: ApplicantsAction) {
    const owned = await prisma.application.findMany({
      where: { id: { in: applicationIds }, driveId, drive: { companyId } },
      select: { id: true, candidateId: true, state: true },
    });
    const skipped: { applicationId: string; reason: string }[] = applicationIds
      .filter((id) => !owned.some((a) => a.id === id))
      .map((applicationId) => ({ applicationId, reason: "Not an applicant to this drive" }));

    if (action !== "reject") {
      // A private note for the employer, so it sits beside the state rather
      // than being one: it doesn't change what the candidate sees.
      await prisma.application.updateMany({
        where: { id: { in: owned.map((a) => a.id) } },
        data: action === "shortlist" ? { shortlistedAt: new Date(), shortlistedBy: userId } : { shortlistedAt: null, shortlistedBy: null },
      });
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
        skipped.push({ applicationId: application.id, reason: err.message });
      }
    }
    await this.live.publish(driveId);
    return { updated, skipped };
  }

  async introAudio(companyId: string, applicationId: string): Promise<{ url: string }> {
    const application = await prisma.application.findFirst({
      where: { id: applicationId, drive: { companyId } },
      select: { candidateId: true },
    });
    if (!application) throw new NotFoundException("Application not found");
    const intro = await prisma.voiceIntro.findFirst({
      where: { candidateId: application.candidateId, replacedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!intro) throw new NotFoundException("No recording");
    return { url: await this.storage.presignPlayback(intro.objectKey) };
  }
}
