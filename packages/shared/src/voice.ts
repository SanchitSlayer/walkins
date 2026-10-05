// Voice intros: limits, and the rules for how an automatic transcript may be
// shown. Those rules live here so the API and the page apply the same ones.
//
// The transcript comes from Whisper, which gets about a quarter of the words
// wrong even on clean synthetic Hindi (more on real phone audio), and is
// wrong fluently. So a transcript is never presented as what someone said:
// how much to trust it, and whether the reader can read it at all, are part of
// what is shown with it.

export const VOICE_MAX_SECONDS = 45;
// 45 seconds of Opus or AAC from a phone is a few hundred kilobytes; 2 MB is
// generous, and MinIO itself refuses anything larger (presigned POST policy).
export const VOICE_MAX_BYTES = 2 * 1024 * 1024;

// What browsers' MediaRecorder produces: Opus in WebM (Chrome, Android), AAC
// in MP4 (Safari, iPhone), Opus in Ogg (Firefox).
export const VOICE_CONTENT_TYPES = ["audio/webm", "audio/mp4", "audio/ogg"] as const;
export type VoiceContentType = (typeof VOICE_CONTENT_TYPES)[number];

export type TranscriptSignals = {
  avgLogprob: number | null;
  noSpeechProb: number | null;
  compressionRatio: number | null;
  languageProbability: number | null;
};

// Whether the audio was clear enough to transcribe. Not whether the words are
// right: a clearly heard wrong word (दीन for तीन) passes every one of these.
// Stricter than Whisper's own thresholds (-1.0 log-probability, 2.4
// compression, 0.6 no-speech), which decide when Whisper throws a segment
// away. This alone decides whether a transcript feeds the candidate's
// embedding.
export function transcriptAudioClear(signals: Omit<TranscriptSignals, "languageProbability">): boolean {
  const { avgLogprob, noSpeechProb, compressionRatio } = signals;
  if (avgLogprob === null || avgLogprob < -0.7) return false;
  if (noSpeechProb !== null && noSpeechProb > 0.5) return false;
  if (compressionRatio !== null && compressionRatio > 2.4) return false;
  return true;
}

// Whether an employer should read rather than hear. Low language confidence
// counts here but not for the embedding: on short Hindi clips, mixed with
// English or not, Whisper often can't settle between Hindi and Urdu, which
// decides the script, not whether the audio was clear. A reader can be handed
// a script they can't read; the embedding model reads both (see README,
// "Transcripts are a guess").
export function transcriptConfidence(signals: TranscriptSignals): "high" | "low" {
  if (!transcriptAudioClear(signals)) return "low";
  if (signals.languageProbability !== null && signals.languageProbability < 0.6) return "low";
  return "high";
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  hi: "Hindi",
  ur: "Urdu",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  or: "Odia",
  as: "Assamese",
  ne: "Nepali",
};

export function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}

export const READABLE_LANGUAGES = Object.keys(LANGUAGE_NAMES);

// The languages each writing system is used for here. A transcript is judged
// by the script it actually came out in, not the language Whisper detected:
// the base model detects Hindi correctly and then writes it in Urdu script.
const SCRIPTS: { name: string; from: number; to: number; languages: string[] }[] = [
  { name: "Latin", from: 0x0041, to: 0x024f, languages: ["en"] },
  { name: "Devanagari", from: 0x0900, to: 0x097f, languages: ["hi", "mr", "ne"] },
  { name: "Bengali", from: 0x0980, to: 0x09ff, languages: ["bn", "as"] },
  { name: "Gurmukhi", from: 0x0a00, to: 0x0a7f, languages: ["pa"] },
  { name: "Gujarati", from: 0x0a80, to: 0x0aff, languages: ["gu"] },
  { name: "Odia", from: 0x0b00, to: 0x0b7f, languages: ["or"] },
  { name: "Tamil", from: 0x0b80, to: 0x0bff, languages: ["ta"] },
  { name: "Telugu", from: 0x0c00, to: 0x0c7f, languages: ["te"] },
  { name: "Kannada", from: 0x0c80, to: 0x0cff, languages: ["kn"] },
  { name: "Malayalam", from: 0x0d00, to: 0x0d7f, languages: ["ml"] },
  { name: "Arabic", from: 0x0600, to: 0x06ff, languages: ["ur"] },
];

// The script most of the letters are in; null for text with no letters.
export function transcriptScript(text: string): { name: string; languages: string[] } | null {
  const counts = new Map<string, number>();
  for (const char of text) {
    const code = char.codePointAt(0)!;
    const script = SCRIPTS.find((s) => code >= s.from && code <= s.to && /\p{L}|\p{M}/u.test(char));
    if (script) counts.set(script.name, (counts.get(script.name) ?? 0) + 1);
  }
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!top) return null;
  const script = SCRIPTS.find((s) => s.name === top[0])!;
  return { name: script.name, languages: script.languages };
}

export type TranscriptReadability = { readable: true } | { readable: false; script: string };

export function transcriptReadability(text: string, readsLanguages: string[]): TranscriptReadability {
  const script = transcriptScript(text);
  if (!script) return { readable: true };
  return script.languages.some((l) => readsLanguages.includes(l)) ? { readable: true } : { readable: false, script: script.name };
}
