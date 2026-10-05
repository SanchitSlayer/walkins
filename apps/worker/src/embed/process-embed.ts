import { prisma } from "@walkins/db";
import { type EmbedJob, formatExperience, formatSalary, transcriptAudioClear } from "@walkins/shared";

export type EmbedDeps = { embed: (texts: string[]) => Promise<number[][]> };

// pgvector's text form: "[0.1,-0.2,...]".
function toVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

async function candidateText(id: string): Promise<string | null> {
  const candidate = await prisma.candidate.findUnique({
    where: { id },
    include: {
      roles: { include: { role: true } },
      city: true,
      voiceIntros: { where: { replacedAt: null, status: "DONE" }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!candidate) return null;
  const [intro] = candidate.voiceIntros;
  // A muddled transcript would place the candidate somewhere they don't
  // belong, so one from unclear audio is left out and their roles and
  // experience place them. Language confidence is deliberately not part of this: a Hindi
  // speaker transcribed in Urdu script embeds almost exactly like the same
  // words in English.
  const transcript = intro && transcriptAudioClear(intro) ? intro.transcript : null;
  return [
    `Looking for work as: ${candidate.roles.map((r) => r.role.title).join(", ") || "any role"}.`,
    `Experience: ${formatExperience(candidate.experienceYears, candidate.experienceYears)}.`,
    `Lives in: ${candidate.city.name}.`,
    transcript ? `In their own words: ${transcript}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function driveText(id: string): Promise<string | null> {
  const drive = await prisma.drive.findUnique({ where: { id }, include: { role: true, city: true } });
  if (!drive) return null;
  return [
    `Hiring: ${drive.role.title}.`,
    `Pay: ${formatSalary(drive.salaryMin, drive.salaryMax)}.`,
    `Experience: ${formatExperience(drive.experienceMin, drive.experienceMax)}.`,
    `Venue: ${drive.venueAddress}, ${drive.city.name}.`,
  ].join(" ");
}

export async function processEmbed({ data }: { data: EmbedJob }, deps: EmbedDeps): Promise<string> {
  const text = data.kind === "candidate" ? await candidateText(data.id) : await driveText(data.id);
  if (!text) return `${data.kind} no longer exists`;
  const [vector] = await deps.embed([text]);
  if (data.kind === "candidate") {
    await prisma.$executeRaw`
      UPDATE candidates SET embedding = ${toVector(vector)}::vector, "embeddedAt" = now() AT TIME ZONE 'UTC' WHERE id = ${data.id}
    `;
  } else {
    await prisma.$executeRaw`
      UPDATE drives SET embedding = ${toVector(vector)}::vector, "embeddedAt" = now() AT TIME ZONE 'UTC' WHERE id = ${data.id}
    `;
  }
  return `embedded ${data.kind}`;
}
