export type VerificationResult = { status: "VERIFIED" | "REJECTED"; reason: string };

// Checks a company is who it says it is. Same pattern as the payment gateway
// and notification channels: the admin service only sees this interface, so a
// real provider (a GST registry or KYC API) replaces the mock without
// touching anything else.
export interface IVerificationProvider {
  readonly name: string;
  verify(company: { name: string; gstin: string | null }): Promise<VerificationResult>;
}

export const VERIFICATION_PROVIDER = Symbol("VERIFICATION_PROVIDER");

// 2-digit state code, 10-character PAN, entity number, Z, check character.
const GSTIN = /^(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Checks only that a GSTIN is present and well formed. It looks nothing up,
// so "verified" from this provider means "plausible", which the reason says.
export class MockVerificationProvider implements IVerificationProvider {
  readonly name = "mock-gstin";

  async verify({ gstin }: { name: string; gstin: string | null }): Promise<VerificationResult> {
    if (!gstin) return { status: "REJECTED", reason: "No GSTIN on file" };
    const match = GSTIN.exec(gstin.trim().toUpperCase());
    if (!match) return { status: "REJECTED", reason: `${gstin} is not a well-formed GSTIN` };
    const state = Number(match[1]);
    if (state < 1 || state > 38) return { status: "REJECTED", reason: `${match[1]} is not an Indian state code` };
    return { status: "VERIFIED", reason: "GSTIN is well formed (mock check: no registry lookup)" };
  }
}
