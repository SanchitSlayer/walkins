"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { otpRequestSchema, otpVerifySchema } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
      setError(parsed.error.errors[0]?.message ?? "Invalid phone number");
      return;
    }

    setLoading(true);
    try {
      const result = await apiClient.requestOtp(parsed.data);
      setDevOtp(result.devOtp ?? null);
      setStep("otp");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request OTP");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = otpVerifySchema.safeParse({ phone, otp });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "Invalid OTP");
      return;
    }

    setLoading(true);
    try {
      const { role } = await apiClient.verifyOtp(parsed.data);
      router.push(role === "EMPLOYER" ? "/employer/drives" : "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify OTP");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border p-6">
        <div>
          <h1 className="text-lg font-semibold">Log in</h1>
          <p className="text-sm text-muted-foreground">
            {step === "phone" ? "Enter your phone number to receive an OTP." : `Enter the code sent to ${phone}.`}
          </p>
        </div>

        {step === "phone" ? (
          <form className="space-y-4" onSubmit={handleRequestOtp}>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone number</Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                placeholder="9999999999"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Sending..." : "Send OTP"}
            </Button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={handleVerifyOtp}>
            <div className="space-y-2">
              <Label htmlFor="otp">6-digit code</Label>
              <Input
                id="otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                autoFocus
              />
              {devOtp && <p className="text-xs text-muted-foreground">Dev mode: OTP is {devOtp}</p>}
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Verifying..." : "Verify"}
            </Button>
            <button
              type="button"
              className="w-full text-center text-sm text-muted-foreground underline"
              onClick={() => {
                setStep("phone");
                setOtp("");
                setError(null);
              }}
            >
              Use a different number
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
