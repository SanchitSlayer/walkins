"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type DriveDetail, type DriveReach, type Member, type MessageKey, updateDriveSchema, type Wallet } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { deriveBoardState, StatusMark } from "@/components/board/board-state";
import { BoardButton, boardButtonClass, BoardField, BoardInput, BoardSelect } from "@/components/board/field";
import { SlotStack } from "@/components/board/slot-stack";
import { VenueOutsideCityNotice } from "../venue-notice";
import { ArrivalsDesk } from "./arrivals-desk";
import { DriveFields, type DriveFieldValues, driveFieldValues, FieldGroup, parseDriveFields } from "../drive-fields";
import { type KnockoutDraft, knockoutDrafts, KnockoutEditor, knockoutQuestions, useDriveIssue } from "../knockout-editor";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";
import { useErrorText } from "@/lib/use-error-text";
import { useMembership } from "@/lib/membership";
import { PersonName } from "@/components/person-name";

// Why a drive is quiet, said up front: an unverified company's alerts go
// only to the nearest few, and the employer should know it and why.
function ReachNotice({ drive }: { drive: DriveDetail }) {
  const t = useTranslations("editDrive.reach");
  const { membership } = useMembership();
  const [reach, setReach] = useState<DriveReach | null>(null);
  const open = drive.status === "DRAFT" || drive.status === "PENDING" || drive.status === "LIVE";

  useEffect(() => {
    if (open) apiClient.getDriveReach(drive.id).then(setReach);
  }, [drive.id, open]);

  if (!reach || reach.limit === null) return null;
  return (
    <p className="type-meta border-l-2 border-pending-lamp pl-3 text-stock">
      {t.rich("limited", {
        company: membership.company.name,
        limit: reach.limit,
        matching: reach.matching,
        capped: reach.matching > reach.limit ? "yes" : "no",
        link: (chunks) => (
          <Link href="/employer/verification" className="underline underline-offset-4">
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}

// Who answers for the drive. Owners can hand it to anyone who runs drives;
// everyone else just sees the name.
function DriveOwner({ drive, onChange }: { drive: DriveDetail; onChange: (next: DriveDetail) => void }) {
  const t = useTranslations("editDrive.owner");
  const errorText = useErrorText();
  const { can } = useMembership();
  const [candidates, setCandidates] = useState<Member[]>([]);
  const [chosen, setChosen] = useState(drive.owner.userId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manages = can("managePeople");

  useEffect(() => {
    if (manages) apiClient.getPeople().then((people) => setCandidates(people.members.filter((m) => m.role !== "VIEWER")));
  }, [manages]);

  async function handOver() {
    setBusy(true);
    setError(null);
    try {
      onChange(await apiClient.reassignDrive(drive.id, chosen));
    } catch (err) {
      setError(errorText(err, "editDrive.owner.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-2">
      <h2 className="type-meta text-housing-muted">{t("heading")}</h2>
      <p className="type-body">
        <PersonName person={drive.owner} />
      </p>
      {manages && candidates.length > 1 && (
        <div className="flex flex-wrap items-end gap-2">
          <BoardField label={t("handTo")}>
            <BoardSelect value={chosen} onChange={(e) => setChosen(e.target.value)}>
              {candidates.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </BoardSelect>
          </BoardField>
          <BoardButton variant="quiet" disabled={busy || chosen === drive.owner.userId} onClick={handOver}>
            {t("handOver")}
          </BoardButton>
        </div>
      )}
      {error && (
        <p role="alert" className="type-meta text-closing-lamp">
          {error}
        </p>
      )}
    </section>
  );
}

export default function EditDrivePage() {
  const t = useTranslations("editDrive");
  const errorText = useErrorText();
  const { can } = useMembership();
  const runs = can("runDrives");
  const driveIssue = useDriveIssue();
  const { formatPaise } = useFormat();
  const params = useParams<{ id: string }>();
  const [drive, setDrive] = useState<DriveDetail | null>(null);
  const [fields, setFields] = useState<DriveFieldValues | null>(null);
  const [capacity, setCapacity] = useState("");
  const [knockouts, setKnockouts] = useState<KnockoutDraft[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [now] = useState(() => new Date());

  function show(next: DriveDetail) {
    setDrive(next);
    setFields(driveFieldValues(next));
    setCapacity(String(next.capacity));
    setKnockouts(knockoutDrafts(next.knockoutQuestions));
  }

  useEffect(() => {
    apiClient.getDrive(params.id).then(show);
    apiClient.getWallet().then(setWallet);
  }, [params.id]);

  const editable = runs && (drive?.status === "DRAFT" || drive?.status === "PENDING");

  async function run(action: () => Promise<DriveDetail>, fallback: MessageKey) {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      show(await action());
      return true;
    } catch (err) {
      setError(errorText(err, fallback));
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!drive || !fields) return;

    const parsed = updateDriveSchema.safeParse({
      ...parseDriveFields(fields),
      capacity: Number(capacity),
      knockoutQuestions: knockoutQuestions(knockouts),
    });
    if (!parsed.success) {
      setError(driveIssue(parsed.error.errors[0]));
      return;
    }
    setSaved(await run(() => apiClient.updateDrive(drive.id, parsed.data), "editDrive.saveFailed"));
  }

  function handleCancel() {
    if (!drive || !confirm(t("cancelConfirm"))) return;
    run(() => apiClient.deleteDrive(drive.id), "editDrive.cancelFailed");
  }

  if (!drive || !fields) {
    return (
      <p role="status" className="type-meta text-housing-muted">
        {t("loading")}
      </p>
    );
  }

  const state = deriveBoardState({ ...drive, bookedCount: drive.slots.reduce((sum, s) => sum + s.bookedCount, 0) }, now);

  return (
    <div className="grid gap-10">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid content-start gap-6">
          <div>
            <Link href="/employer/drives" className="type-meta text-housing-muted underline-offset-4 hover:underline">
              {t("back")}
            </Link>
            <h1 className="type-h2 mt-1">{drive.role.title}</h1>
            <p className="type-meta mt-1 text-housing-muted">{editable ? t("editable") : runs ? t("notEditable") : t("viewOnly")}</p>
          </div>

          <VenueOutsideCityNotice drive={drive} />

          {drive.needsManualGeocode && (
            <p className="type-meta border-l-2 border-filling-lamp pl-3 text-stock">{t("unplaced")}</p>
          )}

          <form className="grid gap-6" onSubmit={handleSave} noValidate>
            <DriveFields
              venuePinnedAt={drive.venuePinnedAt}
              values={fields}
              onChange={(key, value) => {
                setSaved(false);
                setFields((f) => f && { ...f, [key]: value });
              }}
              disabled={!editable}
            />
            <FieldGroup legend={t("seats")}>
              <BoardField label={t("totalSeats")} hint={t("totalSeatsHint")}>
                <BoardInput
                  board
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={capacity}
                  onChange={(e) => {
                    setSaved(false);
                    setCapacity(e.target.value);
                  }}
                  disabled={!editable}
                />
              </BoardField>
            </FieldGroup>

            <KnockoutEditor
              drafts={knockouts}
              onChange={(next) => {
                setSaved(false);
                setKnockouts(next);
              }}
              disabled={!editable}
            />

            {error && (
              <p role="alert" className="type-meta text-closing-lamp">
                {error}
              </p>
            )}
            <p role="status" className={saved ? "type-meta text-live-lamp" : "sr-only"}>
              {saved ? t("saved") : ""}
            </p>

            {editable && (
              <div>
                <BoardButton type="submit" disabled={loading}>
                  {loading ? t("saving") : t("save")}
                </BoardButton>
              </div>
            )}
          </form>
        </div>

        <aside className="grid content-start gap-6 lg:border-l lg:border-housing-line lg:pl-8" aria-label={t("statusAndSlots")}>
          <section className="grid gap-3">
            <h2 className="type-meta text-housing-muted">{t("status")}</h2>
            <StatusMark state={state} surface="housing" className="type-body" />
            {drive.status === "SUSPENDED" && <p className="type-meta border-l-2 border-closing-lamp pl-3 text-stock">{t("suspended")}</p>}
            <ReachNotice drive={drive} />
            {drive.reviewNote != null && (
              <p className="type-meta border-l-2 border-closing-lamp pl-3 text-stock">
                {drive.reviewNote ? t("sentBack", { note: drive.reviewNote }) : t("sentBackNoReason")}
              </p>
            )}
            {(drive.status === "DRAFT" || drive.status === "PENDING") && wallet && !wallet.canGoLive && (
              <p className="type-meta border-l-2 border-filling-lamp pl-3 text-stock">
                {t.rich("lowBalance", {
                  balance: formatPaise(wallet.balancePaise),
                  price: formatPaise(wallet.pricePerCheckInPaise ?? 0),
                  link: (chunks) => (
                    <Link href="/employer/billing" className="underline underline-offset-4">
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            )}
            {runs && drive.status === "DRAFT" && (
              <BoardButton disabled={loading} onClick={() => run(() => apiClient.submitDrive(drive.id), "editDrive.submitFailed")}>
                {t("submit")}
              </BoardButton>
            )}
            {drive.status === "LIVE" && (
              <>
                {runs && (
                  <Link href={`/employer/drives/${drive.id}/checkin`} className={boardButtonClass()}>
                    {t("checkInScreen")}
                  </Link>
                )}
                <Link href={`/employer/drives/${drive.id}/applicants`} className={boardButtonClass("housing", "quiet")}>
                  {t("applicants")}
                </Link>
                <Link href={`/drives/${drive.id}`} className="type-meta text-stock underline underline-offset-4">
                  {t("publicPage")}
                </Link>
              </>
            )}
            {editable && (
              <BoardButton variant="quiet" disabled={loading} onClick={handleCancel}>
                {t("cancel")}
              </BoardButton>
            )}
          </section>

          <DriveOwner drive={drive} onChange={show} />

          <section aria-labelledby="slots-heading">
            <h2 id="slots-heading" className="type-meta text-housing-muted">
              {t("slots")}
            </h2>
            <SlotStack slots={drive.slots} now={now} dense className="mt-1" />
          </section>
        </aside>
      </div>

      {(drive.status === "LIVE" || drive.status === "EXPIRED") && (
        <div className="border-t border-housing-line pt-8">
          <ArrivalsDesk driveId={drive.id} />
        </div>
      )}
    </div>
  );
}
