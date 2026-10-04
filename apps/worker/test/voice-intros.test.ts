import { UnrecoverableError } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@walkins/db";
import { processEmbed } from "../src/embed/process-embed";
import { purgeVoiceIntros } from "../src/maintenance/maintenance-jobs";
import { AudioRefusedError, type Transcription } from "../src/ml/sidecar";
import { processVoice, type VoiceDeps } from "../src/voice/process-voice";

// Real rows, fake sidecar and storage: what's under test is what each outcome
// leaves in the database, which the candidate and employer pages read.
const ids = { user: "", candidate: "" };
const DAY = 24 * 3600_000;

const spoken: Transcription = {
  language: "hi",
  languageProbability: 0.97,
  durationSeconds: 21.4,
  noSpeech: false,
  text: "Mera naam Ravi hai, main do saal se delivery ka kaam kar raha hoon.",
  avgLogprob: -0.3,
  noSpeechProb: 0.02,
  compressionRatio: 1.3,
};

let deps: VoiceDeps & { reembed: ReturnType<typeof vi.fn> };

function intro(data: { createdAt?: Date; replacedAt?: Date | null; status?: "UPLOADED" | "DONE" } = {}) {
  return prisma.voiceIntro.create({
    data: {
      candidateId: ids.candidate,
      objectKey: `voice-intros/test/${crypto.randomUUID()}.webm`,
      contentType: "audio/webm",
      ...data,
    },
  });
}

function attempt(introId: string, attemptsMade = 0) {
  return processVoice({ data: { introId }, attemptsMade, maxAttempts: 3 }, deps);
}

beforeAll(async () => {
  const city = await prisma.city.findFirstOrThrow({ where: { name: "Bengaluru" } });
  const user = await prisma.user.create({ data: { phone: `97${Date.now()}`.slice(0, 10), name: "Voice Test", role: "CANDIDATE" } });
  const role = await prisma.role.findFirstOrThrow();
  const candidate = await prisma.candidate.create({
    data: {
      userId: user.id,
      cityId: city.id,
      homeLat: city.centerLat,
      homeLng: city.centerLng,
      maxTravelKm: 10,
      experienceYears: 2,
      roles: { create: [{ roleId: role.id }] },
    },
  });
  Object.assign(ids, { user: user.id, candidate: candidate.id });
});

beforeEach(async () => {
  await prisma.voiceIntro.deleteMany({ where: { candidateId: ids.candidate } });
  deps = {
    read: vi.fn(async () => Buffer.from("audio")),
    transcribe: vi.fn(async () => spoken),
    reembed: vi.fn(async () => {}),
  };
});

afterAll(async () => {
  await prisma.voiceIntro.deleteMany({ where: { candidateId: ids.candidate } });
  await prisma.candidateRole.deleteMany({ where: { candidateId: ids.candidate } });
  await prisma.candidate.delete({ where: { id: ids.candidate } });
  await prisma.user.delete({ where: { id: ids.user } });
  await prisma.$disconnect();
});

describe("transcribing a voice intro", () => {
  it("stores the transcript with its language and confidence signals, then re-embeds", async () => {
    const { id } = await intro();

    await expect(attempt(id)).resolves.toBe("transcribed (hi, 97%)");

    const row = await prisma.voiceIntro.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "DONE", transcript: spoken.text, language: "hi", languageProbability: 0.97, avgLogprob: -0.3 });
    expect(deps.reembed).toHaveBeenCalledWith({ kind: "candidate", id: ids.candidate });
  });

  it("fails without retrying a recording the sidecar refuses", async () => {
    const { id } = await intro();
    deps.transcribe = vi.fn(async () => {
      throw new AudioRefusedError("too_long", "The recording is longer than 45 seconds.");
    });

    await expect(attempt(id)).rejects.toBeInstanceOf(UnrecoverableError);

    expect(await prisma.voiceIntro.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "FAILED",
      error: "The recording is longer than 45 seconds.",
    });
  });

  it("says so when there was no speech, and doesn't re-embed", async () => {
    const { id } = await intro();
    deps.transcribe = vi.fn(async () => ({ ...spoken, noSpeech: true, text: "" }));

    await expect(attempt(id)).resolves.toBe("no speech");

    expect(await prisma.voiceIntro.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "FAILED",
      error: "No speech was found in the recording.",
    });
    expect(deps.reembed).not.toHaveBeenCalled();
  });

  it("stays processing while a sidecar outage is retried, and fails only on the last attempt", async () => {
    const { id } = await intro();
    deps.transcribe = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    await expect(attempt(id, 0)).rejects.toThrow("ECONNREFUSED");
    expect((await prisma.voiceIntro.findUniqueOrThrow({ where: { id } })).status).toBe("PROCESSING");

    await expect(attempt(id, 2)).rejects.toThrow("ECONNREFUSED");
    expect(await prisma.voiceIntro.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "FAILED",
      error: "This couldn't be transcribed right now. Employers can still listen to it.",
    });
  });

  it("leaves a replaced recording alone", async () => {
    const { id } = await intro({ replacedAt: new Date() });
    await expect(attempt(id)).resolves.toBe("replaced by a newer recording");
    expect(deps.transcribe).not.toHaveBeenCalled();
  });
});

describe("embedding a candidate", () => {
  async function embeddedText() {
    const embed = vi.fn(async (texts: string[]) => [Array.from({ length: 384 }, () => 1 / Math.sqrt(384))]);
    await processEmbed({ data: { kind: "candidate", id: ids.candidate } }, { embed });
    return embed.mock.calls[0][0][0];
  }

  it("writes the vector, and includes a confident transcript", async () => {
    await prisma.voiceIntro.create({
      data: {
        candidateId: ids.candidate,
        objectKey: `voice-intros/test/${crypto.randomUUID()}.webm`,
        contentType: "audio/webm",
        status: "DONE",
        transcript: spoken.text,
        languageProbability: 0.97,
        avgLogprob: -0.3,
        noSpeechProb: 0.02,
        compressionRatio: 1.3,
      },
    });

    expect(await embeddedText()).toContain("In their own words: Mera naam Ravi hai");

    const [{ dims }] = await prisma.$queryRaw<{ dims: number }[]>`
      SELECT vector_dims(embedding) AS dims FROM candidates WHERE id = ${ids.candidate}
    `;
    expect(dims).toBe(384);
  });

  it("includes a transcript whose language was uncertain but whose words were heard clearly", async () => {
    // Hindi mixed with English, detected as Urdu at 48%: the script is in
    // doubt, the words aren't.
    await prisma.voiceIntro.create({
      data: {
        candidateId: ids.candidate,
        objectKey: `voice-intros/test/${crypto.randomUUID()}.webm`,
        contentType: "audio/webm",
        status: "DONE",
        transcript: "مجھے product management میں کام کرنا اچھا لگتا ہے",
        language: "ur",
        languageProbability: 0.48,
        avgLogprob: -0.32,
        noSpeechProb: 0.07,
        compressionRatio: 1.39,
      },
    });

    expect(await embeddedText()).toContain("In their own words: مجھے product management");
  });

  it("leaves out a transcript whose words are likely to be wrong", async () => {
    await prisma.voiceIntro.create({
      data: {
        candidateId: ids.candidate,
        objectKey: `voice-intros/test/${crypto.randomUUID()}.webm`,
        contentType: "audio/webm",
        status: "DONE",
        transcript: "garbled words",
        languageProbability: 0.95,
        avgLogprob: -1.2,
        noSpeechProb: 0.1,
        compressionRatio: 1.2,
      },
    });

    const text = await embeddedText();
    expect(text).toContain("Looking for work as:");
    expect(text).not.toContain("garbled");
  });
});

describe("voice retention", () => {
  it("deletes replaced and 180-day-old recordings, object first, and keeps the current one", async () => {
    const now = new Date();
    const replaced = await intro({ replacedAt: new Date(now.getTime() - DAY) });
    const expired = await intro({ createdAt: new Date(now.getTime() - 181 * DAY) });
    const current = await intro({ createdAt: new Date(now.getTime() - 10 * DAY) });
    const removeObject = vi.fn(async () => {});

    await expect(purgeVoiceIntros({ removeObject, reembed: deps.reembed }, now)).resolves.toBe(2);

    expect(removeObject.mock.calls.map(([key]) => key).sort()).toEqual([expired.objectKey, replaced.objectKey].sort());
    const left = await prisma.voiceIntro.findMany({ where: { candidateId: ids.candidate } });
    expect(left.map((r) => r.id)).toEqual([current.id]);
    // Only the expired one was current, so only it changes what they're embedded from.
    expect(deps.reembed).toHaveBeenCalledExactlyOnceWith({ kind: "candidate", id: ids.candidate });
  });

  it("keeps the row when the object can't be removed, so tomorrow's run tries again", async () => {
    const replaced = await intro({ replacedAt: new Date() });
    const removeObject = vi.fn(async () => {
      throw new Error("storage unavailable");
    });

    await expect(purgeVoiceIntros({ removeObject, reembed: deps.reembed })).rejects.toThrow("storage unavailable");
    expect(await prisma.voiceIntro.findUnique({ where: { id: replaced.id } })).not.toBeNull();
  });
});
