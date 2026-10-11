"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { otpRequestSchema, otpVerifySchema } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, BoardField, BoardInput } from "@/components/board/field";
import { Masthead } from "@/components/board/masthead";
import { Slab } from "@/components/board/slab";
import { useTranslations } from "next-intl";
import { useErrorText, useIssueText } from "@/lib/use-error-text";

// Where to go after logging in, when a page sent us here. Only a path on this
// site: "//host" or a full URL would turn login into an open redirect.
function returnPath(): string | null {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

export default function LoginPage() {
  const t = useTranslations("login");
  const errorText = useErrorText();
  const issueText = useIssueText();
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
      setError(issueText(parsed.error.issues[0]));
      return;
    }

    setLoading(true);
    try {
      const result = await apiClient.requestOtp(parsed.data);
      setDevOtp(result.devOtp ?? null);
      setStep("otp");
    } catch (err) {
      setError(errorText(err, "login.sendFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const parsed = otpVerifySchema.safeParse({ phone, otp });
    if (!parsed.success) {
      setError(issueText(parsed.error.issues[0]));
      return;
    }

    setLoading(true);
    try {
      const { role } = await apiClient.verifyOtp(parsed.data);
      // Someone a company invited sees the invitation first, with the
      // company's name, before anything else.
      const invited = role === "CANDIDATE" && (await apiClient.myInvitations()).invitations.length > 0;
      router.push(invited ? "/join" : (returnPath() ?? (role === "EMPLOYER" ? "/employer/drives" : role === "ADMIN" ? "/admin" : "/profile")));
    } catch (err) {
      setError(errorText(err, "login.checkFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-housing text-stock">
      <Masthead />
      <main className="mx-auto grid max-w-md gap-6 px-4 py-12 sm:py-20">
        <div>
          <h1 className="type-h1">{t("heading")}</h1>
          <p className="type-body mt-2 text-housing-muted">{step === "phone" ? t("phoneIntro") : t("codeIntro", { phone })}</p>
        </div>

        <Slab depth="md" className="w-full p-5">
          {step === "phone" ? (
            <form className="grid gap-5" onSubmit={handleRequestOtp} noValidate>
              <BoardField label={t("phone")} hint={t("phoneHint")} surface="stock">
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
                {loading ? t("sending") : t("send")}
              </BoardButton>
            </form>
          ) : (
            <form className="grid gap-5" onSubmit={handleVerifyOtp} noValidate>
              <BoardField
                label={t("code")}
                surface="stock"
                hint={devOtp ? t("devCode", { code: devOtp }) : undefined}
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
                {loading ? t("checking") : t("logIn")}
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
                {t("differentNumber")}
              </BoardButton>
            </form>
          )}
        </Slab>
      </main>
    </div>
  );
}
