// The provider's verdict is a catalog code with its values, worded where it
// is shown; code "wellFormed" is as far as the mock goes.
export type VerificationResult = { status: "VERIFIED" | "REJECTED"; code: string; params: Record<string, string> };

// Checks a company is who it says it is. Same pattern as the payment gateway
// and notification channels: the verification service only sees this
// interface, so a real provider (a GST registry or KYC API) replaces the mock
// without touching anything else. Its answer is advice for the admin, who
// makes the decision.
export interface IVerificationProvider {
  readonly name: string;
  verify(company: { name: string; gstin: string }): Promise<VerificationResult>;
}

export const VERIFICATION_PROVIDER = Symbol("VERIFICATION_PROVIDER");

// 2-digit state code, 10-character PAN, entity number, Z, check character.
const GSTIN = /^(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Checks only that a GSTIN is well formed. It looks nothing up, so its
// "verified" means "plausible", which is how the admin page words it.
export class MockVerificationProvider implements IVerificationProvider {
  readonly name = "mock-gstin";

  async verify({ gstin }: { name: string; gstin: string }): Promise<VerificationResult> {
    const match = GSTIN.exec(gstin.trim().toUpperCase());
    if (!match) return { status: "REJECTED", code: "malformed", params: { gstin } };
    const state = Number(match[1]);
    if (state < 1 || state > 38) return { status: "REJECTED", code: "badState", params: { state: match[1] } };
    return { status: "VERIFIED", code: "wellFormed", params: {} };
  }
}
