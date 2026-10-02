// The code on the venue screen stands in for the signed check-in token, which
// never leaves the server: a short code makes a QR coarse enough to read off a
// laptop screen at standing distance, and short enough to type.
//
// Crockford base32 leaves out I, L, O and U so a code read off a screen can't
// be misread. Eight characters is 40 bits. A code keeps resolving for its 90
// seconds plus the 30-minute offline grace, so with 100 live drives about 3,200
// codes resolve at once; 40 bits still leaves ~344 million guesses per hit,
// and failed lookups are rate limited on top of that.
export const CHECKIN_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CHECKIN_CODE_LENGTH = 8;

// Accepts what a person types: any case, spaces or dashes, and the letters
// people mistake for digits. Returns null if it can't be a code at all.
export function normalizeCheckInCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (code.length !== CHECKIN_CODE_LENGTH) return null;
  return [...code].every((char) => CHECKIN_CODE_ALPHABET.includes(char)) ? code : null;
}

// "K7QF4XM2" as "K7QF 4XM2": two groups are easier to read out and type.
export function formatCheckInCode(code: string): string {
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}
