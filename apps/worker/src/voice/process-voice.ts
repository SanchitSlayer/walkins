import { UnrecoverableError } from "bullmq";
import { prisma } from "@walkins/db";
import type { EmbedJob, VoiceJob } from "@walkins/shared";
import { AudioRefusedError, type Transcription } from "../ml/sidecar";

export type VoiceDeps = {
  read: (key: string) => Promise<Buffer>;
  transcribe: (audio: Buffer) => Promise<Transcription>;
  reembed: (job: EmbedJob) => Promise<void>;
};

export type VoiceAttempt = { data: VoiceJob; attemptsMade: number; maxAttempts: number };

// A failed transcript never hides the candidate: the recording stays, and
// employers are offered the audio instead of text. FAILED here only ever
// means "no transcript", never "no intro".
export async function processVoice({ data, attemptsMade, maxAttempts }: VoiceAttempt, deps: VoiceDeps): Promise<string> {
  const intro = await prisma.voiceIntro.findUnique({ where: { id: data.introId } });
  if (!intro) return "intro no longer exists";
  if (intro.replacedAt) return "replaced by a newer recording";
  if (intro.status === "DONE") return "already transcribed";

  await prisma.voiceIntro.update({ where: { id: intro.id }, data: { status: "PROCESSING", error: null } });
  try {
    const result = await deps.transcribe(await deps.read(intro.objectKey));
    if (result.noSpeech) {
      await prisma.voiceIntro.update({
        where: { id: intro.id },
        data: {
          status: "FAILED",
          error: "No speech was found in the recording.",
          durationSeconds: result.durationSeconds,
          processedAt: new Date(),
        },
      });
      return "no speech";
    }
    await prisma.voiceIntro.update({
      where: { id: intro.id },
      data: {
        status: "DONE",
        transcript: result.text,
        language: result.language,
        languageProbability: result.languageProbability,
        durationSeconds: result.durationSeconds,
        avgLogprob: result.avgLogprob,
        noSpeechProb: result.noSpeechProb,
        compressionRatio: result.compressionRatio,
        processedAt: new Date(),
      },
    });
    await deps.reembed({ kind: "candidate", id: intro.candidateId });
    return `transcribed (${result.language}, ${Math.round(result.languageProbability * 100)}%)`;
  } catch (err) {
    if (err instanceof AudioRefusedError) {
      await prisma.voiceIntro.update({ where: { id: intro.id }, data: { status: "FAILED", error: err.message, processedAt: new Date() } });
      throw new UnrecoverableError(err.message);
    }
    // The sidecar is down or slow. Until the last attempt the intro stays
    // PROCESSING, so the candidate isn't told it failed while it's retrying.
    if (attemptsMade + 1 >= maxAttempts) {
      await prisma.voiceIntro.update({
        where: { id: intro.id },
        data: {
          status: "FAILED",
          error: "This couldn't be transcribed right now. Employers can still listen to it.",
          processedAt: new Date(),
        },
      });
    }
    throw err;
  }
}
