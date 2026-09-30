"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { otpRequestSchema, otpVerifySchema } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, BoardField, BoardInput } from "@/components/board/field";
import { Masthead } from "@/components/board/masthead";
import { Slab } from "@/components/board/slab";

// Where to go after logging in, when a page sent us here. Only a path on this
// site: "//host" or a full URL would turn login into an open redirect.
function returnPath(): string | null {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRequestOtp(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = otpRequestSchema.safeParse({ phone });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "Enter a valid phone number");
      return;
    }

    setLoading(true);
    try {
      const result = await apiClient.requestOtp(parsed.data);
      setDevOtp(result.devOtp ?? null);
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the code");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = otpVerifySchema.safeParse({ phone, otp });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "Enter the 6-digit code");
      return;
    }

    setLoading(true);
    try {
      const { role } = await apiClient.verifyOtp(parsed.data);
      router.push(returnPath() ?? (role === "EMPLOYER" ? "/employer/drives" : "/profile"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check the code");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-housing text-stock">
      <Masthead />
      <main className="mx-auto grid max-w-md gap-6 px-4 py-12 sm:py-20">
        <div>
          <h1 className="type-h1">Log in</h1>
          <p className="type-body mt-2 text-housing-muted">
            {step === "phone" ? "We'll text a one-time code to your phone." : `Enter the code sent to ${phone}.`}
          </p>
        </div>

        <Slab depth="md" className="w-full p-5">
          {step === "phone" ? (
            <form className="grid gap-5" onSubmit={handleRequestOtp} noValidate>
              <BoardField label="Phone number" hint="Your 10-digit mobile number" surface="stock">
                <BoardInput
                  surface="stock"
                  board
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  autoFocus
                />
              </BoardField>
              {error && (
                <p role="alert" className="type-meta text-closing-ink">
                  {error}
                </p>
              )}
              <BoardButton type="submit" surface="stock" disabled={loading}>
                {loading ? "Sending code" : "Send code"}
              </BoardButton>
            </form>
          ) : (
            <form className="grid gap-5" onSubmit={handleVerifyOtp} noValidate>
              <BoardField
                label="6-digit code"
                surface="stock"
                hint={devOtp ? `Development build: the code is ${devOtp}` : undefined}
              >
                <BoardInput
                  surface="stock"
                  board
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  autoFocus
                  className="tracking-[0.3em]"
                />
              </BoardField>
              {error && (
                <p role="alert" className="type-meta text-closing-ink">
                  {error}
                </p>
              )}
              <BoardButton type="submit" surface="stock" disabled={loading}>
                {loading ? "Checking code" : "Log in"}
              </BoardButton>
              <BoardButton
                surface="stock"
                variant="quiet"
                onClick={() => {
                  setStep("phone");
                  setOtp("");
                  setError(null);
                }}
              >
                Use a different number
              </BoardButton>
            </form>
          )}
        </Slab>
      </main>
    </div>
  );
}
