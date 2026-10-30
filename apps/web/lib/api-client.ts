"use client";

import type {
  ErrorValues,
  AdminDrive,
  AdminRetention,
  CandidateRecord,
  AdminSubmission,
  CandidateReport,
  CompanyStanding,
  DecideSubmission,
  DocumentUpload,
  DriveReach,
  DriveReport,
  FlaggedMessage,
  MessageReport,
  Moderate,
  OutcomeRow,
  Outcomes,
  RecordOutcome,
  ModerationQueue,
  SubmitVerification,
  Thread,
  ThreadList,
  Warning,
  Analytics,
  Applicants,
  ApplicantsAction,
  CandidateProfile,
  CheckIn,
  CheckInRequest,
  CheckInResult,
  CheckInCode,
  CompanyInvitation,
  CompanyRole,
  CompanySettings,
  CreatePricingRule,
  CreateDriveInput,
  CursorPage,
  DriveDetail,
  DriveSearchPage,
  EmployerApplicationUpdate,
  EmployerDriveRow,
  FailedJob,
  Handover,
  Invite,
  KnockoutAnswers,
  LedgerExplorer,
  Locale,
  LiveBoard,
  LiveDisplay,
  Membership,
  MessageKey,
  MyApplication,
  MyApplications,
  ModerateDrive,
  MyInvitations,
  OtpRequestInput,
  OtpVerifyInput,
  People,
  PricingRuleView,
  PublicDriveDetail,
  SetLocale,
  TelegramLink,
  TopUpOrder,
  TopUpStatus,
  UpdateCandidateProfileInput,
  UpdateDriveInput,
  VenuePinInput,
  VoiceContentType,
  VoiceIntro,
  VoiceUpload,
  Wallet,
} from "@walkins/shared";

// Same-origin, proxied to the API by next.config.ts; see lib/api-internal-url.ts.
const API_URL = "/api";

// Held in memory only (never localStorage) — refreshed via the httpOnly
// refresh cookie, which the browser sends automatically with credentials:
// "include". Lost on a full page reload by design; restoreSession() below
// re-establishes it from the cookie.
let accessToken: string | null = null;

// users.locale as the API last reported it, with every session it issues:
// what a candidate has chosen to read, which may differ from the page in
// front of them (a shared /hi link, another device's choice).
let savedLocale: Locale | null = null;

type JwtPayload = { userId: string; role: string; companyId: string | null; exp: number };

function decodeAccessToken(token: string): JwtPayload {
  const payload = token.split(".")[1];
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64));
}

// Single-flight: the refresh token rotates on every use and the API treats a
// second use of the same token as theft (revoking every session), so two
// components refreshing at once on page load must share one request.
let refreshing: Promise<boolean> | null = null;

function refreshAccessToken(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const response = await fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" });
      if (!response.ok) {
        accessToken = null;
        return false;
      }
      const data = await response.json();
      accessToken = data.accessToken;
      savedLocale = data.locale;
      return true;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function request(path: string, options: RequestInit = {}, retry = true): Promise<Response> {
  const headers = new Headers(options.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });

  if (response.status === 401 && retry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return request(path, options, false);
    }
  }

  return response;
}

// A refusal from the API: its catalog code and values, which pages turn
// into words with useErrorText(), plus the status and body for the few
// callers that act on a specific refusal (a pin far from the city asks to
// confirm). message is the API's default-locale wording, for logs.
export class ApiError extends Error {
  name = "ApiError";
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> | null,
    readonly code: string = typeof body?.code === "string" ? body.code : "errors.generic",
  ) {
    super(message);
  }

  get params(): ErrorValues {
    return (this.body?.params as ErrorValues | undefined) ?? {};
  }
}

async function parseOrThrow<T>(response: Response): Promise<T> {
  // Nest sends an empty body (not the JSON literal "null") for a
  // controller returning null — .json() throws on that, so the fallback
  // must be null too, not {}, or an empty-but-truthy object silently masks
  // "no data" as "some data with no fields" for every caller downstream.
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(typeof data?.message === "string" ? data.message : `HTTP ${response.status}`, response.status, data); // i18n-ignore: log text; pages show the code's wording
  }
  return data as T;
}

export const apiClient = {
  async requestOtp(input: OtpRequestInput): Promise<{ devOtp?: string }> {
    return parseOrThrow(await request("/auth/otp/request", { method: "POST", body: JSON.stringify(input) }));
  },

  async verifyOtp(input: OtpVerifyInput): Promise<{ role: string; companyId: string | null }> {
    const data = await parseOrThrow<{ accessToken: string; locale: Locale }>(
      await request("/auth/otp/verify", { method: "POST", body: JSON.stringify(input) }),
    );
    accessToken = data.accessToken;
    savedLocale = data.locale;
    const payload = decodeAccessToken(data.accessToken);
    return { role: payload.role, companyId: payload.companyId };
  },

  async logout(): Promise<void> {
    await request("/auth/logout", { method: "POST" });
    accessToken = null;
    savedLocale = null;
  },

  // Re-establishes a session from the httpOnly refresh cookie after a page
  // load. Reuses a token already in memory rather than rotating again.
  async restoreSession(): Promise<{ role: string; companyId: string | null } | null> {
    const ok = accessToken !== null || (await refreshAccessToken());
    if (!ok || !accessToken) return null;
    const payload = decodeAccessToken(accessToken);
    return { role: payload.role, companyId: payload.companyId };
  },

  // For the live-board socket, which presents a token only when it connects:
  // a still-valid one, refreshed first (through the same single-flight
  // refresh as everything else) if it expires within the next 30 seconds.
  async socketToken(): Promise<string | null> {
    if (!accessToken || decodeAccessToken(accessToken).exp * 1000 - Date.now() < 30_000) {
      await refreshAccessToken();
    }
    return accessToken;
  },

  isAuthenticated(): boolean {
    return accessToken !== null;
  },

  getCurrentUserId(): string | null {
    return accessToken ? decodeAccessToken(accessToken).userId : null;
  },

  getCurrentRole(): string | null {
    return accessToken ? decodeAccessToken(accessToken).role : null;
  },

  getSavedLocale(): Locale | null {
    return savedLocale;
  },

  // The API saves it and sets the middleware's cookie from what it saved.
  async setLocale(locale: Locale): Promise<SetLocale> {
    const saved = await parseOrThrow<SetLocale>(await request("/candidates/me/locale", { method: "PATCH", body: JSON.stringify({ locale }) }));
    savedLocale = saved.locale;
    return saved;
  },

  async createDrive(input: CreateDriveInput): Promise<DriveDetail> {
    return parseOrThrow(await request("/drives", { method: "POST", body: JSON.stringify(input) }));
  },

  async updateDrive(id: string, input: UpdateDriveInput): Promise<DriveDetail> {
    return parseOrThrow(await request(`/drives/${id}`, { method: "PATCH", body: JSON.stringify(input) }));
  },

  async submitDrive(id: string): Promise<DriveDetail> {
    return parseOrThrow(await request(`/drives/${id}/submit`, { method: "POST" }));
  },

  async deleteDrive(id: string): Promise<DriveDetail> {
    return parseOrThrow(await request(`/drives/${id}`, { method: "DELETE" }));
  },

  async getDrive(id: string): Promise<DriveDetail> {
    return parseOrThrow(await request(`/drives/${id}`));
  },

  async getCheckInCode(driveId: string): Promise<CheckInCode> {
    return parseOrThrow(await request(`/drives/${driveId}/checkin-code`));
  },

  async pinVenue(driveId: string, input: VenuePinInput): Promise<DriveDetail> {
    return parseOrThrow(await request(`/drives/${driveId}/venue-pin`, { method: "POST", body: JSON.stringify(input) }));
  },

  async getLiveDesk(driveId: string): Promise<LiveBoard> {
    return parseOrThrow(await request(`/drives/${driveId}/live`));
  },

  async getLiveDisplay(driveId: string): Promise<LiveDisplay> {
    return parseOrThrow(await request(`/drives/${driveId}/live/display`));
  },

  async confirmCheckIn(checkInId: string): Promise<CheckIn> {
    return parseOrThrow(await request(`/check-ins/${checkInId}/confirm`, { method: "POST" }));
  },

  async markPresent(applicationId: string, reason?: string): Promise<CheckInResult> {
    return parseOrThrow(
      await request(`/applications/${applicationId}/check-in`, { method: "POST", body: JSON.stringify({ reason }) }),
    );
  },

  async updateApplicationState(applicationId: string, to: EmployerApplicationUpdate["to"]): Promise<{ id: string; state: string }> {
    return parseOrThrow(
      await request(`/applications/${applicationId}/state`, { method: "PATCH", body: JSON.stringify({ to }) }),
    );
  },

  async listApplicants(driveId: string, weight: number): Promise<Applicants> {
    return parseOrThrow(await request(`/drives/${driveId}/applicants?weight=${weight}`));
  },

  async actOnApplicants(
    driveId: string,
    input: ApplicantsAction,
  ): Promise<{ updated: number; skipped: { applicationId: string; code: MessageKey }[] }> {
    return parseOrThrow(await request(`/drives/${driveId}/applicants/actions`, { method: "POST", body: JSON.stringify(input) }));
  },

  async getIntroAudio(applicationId: string): Promise<{ url: string }> {
    return parseOrThrow(await request(`/applications/${applicationId}/intro-audio`));
  },

  async getCompanySettings(): Promise<CompanySettings> {
    return parseOrThrow(await request("/companies/me"));
  },

  async updateCompanySettings(input: CompanySettings): Promise<CompanySettings> {
    return parseOrThrow(await request("/companies/me", { method: "PATCH", body: JSON.stringify(input) }));
  },

  async getMembership(): Promise<Membership> {
    return parseOrThrow(await request("/companies/me/membership"));
  },

  async getPeople(): Promise<People> {
    return parseOrThrow(await request("/companies/me/people"));
  },

  async invite(input: Invite): Promise<CompanyInvitation> {
    return parseOrThrow(await request("/companies/me/invitations", { method: "POST", body: JSON.stringify(input) }));
  },

  async revokeInvitation(id: string): Promise<void> {
    return parseOrThrow(await request(`/companies/me/invitations/${id}`, { method: "DELETE" }));
  },

  async changeRole(userId: string, role: CompanyRole, successorId?: string): Promise<Handover> {
    return parseOrThrow(await request(`/companies/me/members/${userId}`, { method: "PATCH", body: JSON.stringify({ role, successorId }) }));
  },

  async removeMember(userId: string, successorId?: string): Promise<Handover> {
    return parseOrThrow(await request(`/companies/me/members/${userId}/remove`, { method: "POST", body: JSON.stringify({ successorId }) }));
  },

  async rescheduleDrive(driveId: string, input: { startsAt: Date; endsAt: Date }): Promise<DriveDetail> {
    return parseOrThrow(await request(`/drives/${driveId}/reschedule`, { method: "POST", body: JSON.stringify(input) }));
  },

  async reassignDrive(driveId: string, ownerId: string): Promise<DriveDetail> {
    return parseOrThrow(await request(`/drives/${driveId}/owner`, { method: "POST", body: JSON.stringify({ ownerId }) }));
  },

  async myInvitations(): Promise<MyInvitations> {
    return parseOrThrow(await request("/invitations/mine"));
  },

  async acceptInvitation(id: string): Promise<Membership> {
    return parseOrThrow(await request(`/invitations/${id}/accept`, { method: "POST" }));
  },

  async getAnalytics(): Promise<Analytics> {
    return parseOrThrow(await request("/companies/me/analytics"));
  },

  async getWallet(): Promise<Wallet> {
    return parseOrThrow(await request("/billing/wallet"));
  },

  async createTopUp(amountPaise: number): Promise<TopUpOrder> {
    return parseOrThrow(await request("/billing/top-ups", { method: "POST", body: JSON.stringify({ amountPaise }) }));
  },

  async confirmTopUp(orderId: string, gatewayPaymentId: string, signature: string): Promise<TopUpStatus> {
    return parseOrThrow(
      await request(`/billing/top-ups/${orderId}/confirm`, { method: "POST", body: JSON.stringify({ gatewayPaymentId, signature }) }),
    );
  },

  async getTopUp(orderId: string): Promise<TopUpStatus> {
    return parseOrThrow(await request(`/billing/top-ups/${orderId}`));
  },

  async mockCheckout(orderId: string, outcome: "success" | "failure"): Promise<{ gatewayPaymentId: string; signature: string }> {
    return parseOrThrow(await request(`/billing/top-ups/${orderId}/mock-checkout`, { method: "POST", body: JSON.stringify({ outcome }) }));
  },

  async adminDrives(): Promise<AdminDrive[]> {
    return parseOrThrow(await request("/admin/drives"));
  },

  async adminModerateDrive(driveId: string, input: ModerateDrive): Promise<AdminDrive> {
    return parseOrThrow(await request(`/admin/drives/${driveId}/moderation`, { method: "POST", body: JSON.stringify(input) }));
  },

  async adminFailedJobs(): Promise<FailedJob[]> {
    return parseOrThrow(await request("/admin/jobs/failed"));
  },

  async adminRetryJob(queue: string, jobId: string): Promise<{ retried: boolean }> {
    return parseOrThrow(
      await request(`/admin/jobs/${encodeURIComponent(queue)}/${encodeURIComponent(jobId)}/retry`, { method: "POST" }),
    );
  },

  async adminLedger(filter: { accountId?: string; txnId?: string }): Promise<LedgerExplorer> {
    const query = new URLSearchParams(Object.entries(filter).filter((e): e is [string, string] => !!e[1])).toString();
    return parseOrThrow(await request(`/admin/ledger${query ? `?${query}` : ""}`));
  },

  async adminPricing(): Promise<PricingRuleView[]> {
    return parseOrThrow(await request("/admin/pricing"));
  },

  async adminCreatePricing(input: CreatePricingRule): Promise<PricingRuleView> {
    return parseOrThrow(await request("/admin/pricing", { method: "POST", body: JSON.stringify(input) }));
  },

  async listMyDrives(cursor?: string): Promise<CursorPage<EmployerDriveRow>> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return parseOrThrow(await request(`/drives/mine${query}`));
  },

  async listRoles(): Promise<{ id: string; title: string; slug: string }[]> {
    return parseOrThrow(await request("/roles"));
  },

  async listCities(): Promise<{ id: string; name: string; state: string; centerLat: number; centerLng: number }[]> {
    return parseOrThrow(await request("/cities"));
  },

  async getMyProfile(): Promise<CandidateProfile | null> {
    return parseOrThrow(await request("/candidates/me"));
  },

  async updateMyProfile(input: UpdateCandidateProfileInput): Promise<CandidateProfile> {
    return parseOrThrow(await request("/candidates/me", { method: "PATCH", body: JSON.stringify(input) }));
  },

  async getMyVoiceIntro(): Promise<VoiceIntro | null> {
    return parseOrThrow(await request("/candidates/me/voice-intro"));
  },

  // The recording goes from the browser to storage on a presigned policy,
  // never through the API; the API is only told once it has arrived.
  async uploadVoiceIntro(recording: Blob, contentType: VoiceContentType): Promise<VoiceIntro> {
    const upload = await parseOrThrow<VoiceUpload>(
      await request("/candidates/me/voice-intro/uploads", { method: "POST", body: JSON.stringify({ contentType }) }),
    );
    const form = new FormData();
    for (const [key, value] of Object.entries(upload.fields)) form.append(key, value);
    form.append("file", recording);
    const stored = await fetch(upload.url, { method: "POST", body: form });
    if (!stored.ok) {
      const code = recording.size > upload.maxBytes ? "errors.voice.tooLarge" : "errors.voice.uploadFailed";
      throw new ApiError(code, stored.status, null, code);
    }
    return parseOrThrow(await request(`/candidates/me/voice-intro/uploads/${upload.introId}/complete`, { method: "POST" }));
  },

  async createTelegramLink(): Promise<TelegramLink> {
    return parseOrThrow(await request("/candidates/me/telegram-link", { method: "POST" }));
  },

  async apply(driveId: string, slotId: string, answers: KnockoutAnswers): Promise<MyApplication> {
    return parseOrThrow(
      await request(`/drives/${driveId}/apply`, { method: "POST", body: JSON.stringify({ slotId, answers }) }),
    );
  },

  async releaseApplication(id: string): Promise<MyApplication> {
    return parseOrThrow(await request(`/applications/${id}`, { method: "DELETE" }));
  },

  async listMyApplications(): Promise<MyApplications> {
    return parseOrThrow(await request("/applications/mine"));
  },

  async checkIn(input: CheckInRequest): Promise<CheckInResult> {
    return parseOrThrow(await request("/check-in", { method: "POST", body: JSON.stringify(input) }));
  },

  // No session needed; one is sent if there is.
  async reportDrive(driveId: string, input: DriveReport): Promise<{ received: true }> {
    return parseOrThrow(await request(`/drives/${driveId}/report`, { method: "POST", body: JSON.stringify(input) }));
  },

  async reportCandidate(input: CandidateReport): Promise<{ received: true }> {
    return parseOrThrow(await request("/reports/candidate", { method: "POST", body: JSON.stringify(input) }));
  },

  async getStanding(): Promise<CompanyStanding> {
    return parseOrThrow(await request("/companies/me/standing"));
  },

  // Straight to storage with the signed policy, like a voice intro; the
  // returned key goes into the submission.
  async uploadVerificationDocument(file: File): Promise<string> {
    const upload: DocumentUpload = await parseOrThrow(
      await request("/companies/me/verification/documents", { method: "POST", body: JSON.stringify({ contentType: file.type, bytes: file.size }) }),
    );
    const form = new FormData();
    for (const [name, value] of Object.entries(upload.fields)) form.append(name, value);
    form.append("file", file);
    const stored = await fetch(upload.url, { method: "POST", body: form });
    if (!stored.ok) throw new ApiError("errors.verification.documentMissing", stored.status, null, "errors.verification.documentMissing");
    return upload.key;
  },

  async submitVerification(input: SubmitVerification): Promise<CompanyStanding> {
    return parseOrThrow(await request("/companies/me/verification", { method: "POST", body: JSON.stringify(input) }));
  },

  async getDriveReach(driveId: string): Promise<DriveReach> {
    return parseOrThrow(await request(`/drives/${driveId}/reach`));
  },

  async myWarnings(): Promise<Warning[]> {
    return parseOrThrow(await request("/warnings/mine"));
  },

  async acknowledgeWarning(id: string): Promise<void> {
    return parseOrThrow(await request(`/warnings/${id}/acknowledge`, { method: "POST" }));
  },

  async adminVerificationQueue(): Promise<AdminSubmission[]> {
    return parseOrThrow(await request("/admin/verification"));
  },

  async adminDecideSubmission(id: string, input: DecideSubmission): Promise<AdminSubmission> {
    return parseOrThrow(await request(`/admin/verification/${id}/decision`, { method: "POST", body: JSON.stringify(input) }));
  },

  async adminModerationQueue(): Promise<ModerationQueue> {
    return parseOrThrow(await request("/admin/moderation"));
  },

  async adminModerate(input: Moderate): Promise<ModerationQueue> {
    return parseOrThrow(await request("/admin/moderation", { method: "POST", body: JSON.stringify(input) }));
  },

  async getMyRecord(): Promise<CandidateRecord> {
    return parseOrThrow(await request("/candidates/me/record"));
  },

  async adminRetention(): Promise<AdminRetention> {
    return parseOrThrow(await request("/admin/retention"));
  },

  async companyOutcomes(driveId?: string): Promise<Outcomes> {
    return parseOrThrow(await request(`/companies/me/outcomes${driveId ? `?driveId=${encodeURIComponent(driveId)}` : ""}`));
  },

  async recordOutcome(applicationId: string, input: RecordOutcome): Promise<OutcomeRow> {
    return parseOrThrow(await request(`/applications/${applicationId}/outcome`, { method: "PATCH", body: JSON.stringify(input) }));
  },

  async answerStarted(applicationId: string, started: boolean): Promise<void> {
    return parseOrThrow(await request(`/applications/${applicationId}/started`, { method: "POST", body: JSON.stringify({ started }) }));
  },

  async companyThreads(driveId?: string): Promise<ThreadList> {
    return parseOrThrow(await request(`/companies/me/threads${driveId ? `?driveId=${encodeURIComponent(driveId)}` : ""}`));
  },

  async companyThread(applicationId: string): Promise<Thread> {
    return parseOrThrow(await request(`/companies/me/threads/${applicationId}`));
  },

  async companySend(applicationId: string, body: string): Promise<Thread> {
    return parseOrThrow(await request(`/companies/me/threads/${applicationId}/messages`, { method: "POST", body: JSON.stringify({ body }) }));
  },

  async companyRead(applicationId: string, seq: number): Promise<void> {
    return parseOrThrow(await request(`/companies/me/threads/${applicationId}/read`, { method: "POST", body: JSON.stringify({ seq }) }));
  },

  async flaggedMessages(): Promise<FlaggedMessage[]> {
    return parseOrThrow(await request("/companies/me/flagged-messages"));
  },

  async reviewFlaggedMessage(messageId: string): Promise<void> {
    return parseOrThrow(await request(`/companies/me/flagged-messages/${messageId}/reviewed`, { method: "POST" }));
  },

  async myThreads(): Promise<ThreadList> {
    return parseOrThrow(await request("/me/threads"));
  },

  async myThread(applicationId: string): Promise<Thread> {
    return parseOrThrow(await request(`/me/threads/${applicationId}`));
  },

  async mySend(applicationId: string, body: string): Promise<Thread> {
    return parseOrThrow(await request(`/me/threads/${applicationId}/messages`, { method: "POST", body: JSON.stringify({ body }) }));
  },

  async myRead(applicationId: string, seq: number): Promise<void> {
    return parseOrThrow(await request(`/me/threads/${applicationId}/read`, { method: "POST", body: JSON.stringify({ seq }) }));
  },

  async reportMessage(messageId: string, input: MessageReport): Promise<{ received: true }> {
    return parseOrThrow(await request(`/messages/${messageId}/report`, { method: "POST", body: JSON.stringify(input) }));
  },

  // Audited on the server each time it is opened.
  async adminThread(threadId: string): Promise<Thread> {
    return parseOrThrow(await request(`/admin/threads/${threadId}`));
  },

  async getPublicDrive(id: string): Promise<PublicDriveDetail> {
    return parseOrThrow(await request(`/drives/${id}/public`));
  },

  async searchDrives(
    params: { city?: string; role?: string; radiusKm?: number; fromDate?: string; toDate?: string; cursor?: string },
  ): Promise<DriveSearchPage> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const qs = query.toString();
    return parseOrThrow(await request(`/drives/search${qs ? `?${qs}` : ""}`));
  },
};
