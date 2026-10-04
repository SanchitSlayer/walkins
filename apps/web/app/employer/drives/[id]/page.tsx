"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { updateDriveSchema } from "@walkins/shared";
import type { DriveDetail } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { deriveBoardState, StatusMark } from "@/components/board/board-state";
import { BoardButton, boardButtonClass, BoardField, BoardInput } from "@/components/board/field";
import { SlotStack } from "@/components/board/slot-stack";
import { VenueOutsideCityNotice } from "../venue-notice";
import { ArrivalsDesk } from "./arrivals-desk";
import { DriveFields, type DriveFieldValues, driveFieldValues, FieldGroup, parseDriveFields } from "../drive-fields";
import { driveIssue, type KnockoutDraft, knockoutDrafts, KnockoutEditor, knockoutQuestions } from "../knockout-editor";

export default function EditDrivePage() {
  const params = useParams<{ id: string }>();
  const [drive, setDrive] = useState<DriveDetail | null>(null);
  const [fields, setFields] = useState<DriveFieldValues | null>(null);
  const [capacity, setCapacity] = useState("");
  const [knockouts, setKnockouts] = useState<KnockoutDraft[]>([]);
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
  }, [params.id]);

  const editable = drive?.status === "DRAFT" || drive?.status === "PENDING";

  async function run(action: () => Promise<DriveDetail>, fallback: string) {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      show(await action());
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
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
    setSaved(await run(() => apiClient.updateDrive(drive.id, parsed.data), "Couldn't save the drive"));
  }

  function handleCancel() {
    if (!drive || !confirm("Cancel this drive? Candidates will no longer see it, and this can't be undone.")) return;
    run(() => apiClient.deleteDrive(drive.id), "Couldn't cancel the drive");
  }

  if (!drive || !fields) {
    return (
      <p role="status" className="type-meta text-housing-muted">
        Loading drive
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
              Drives
            </Link>
            <h1 className="type-h2 mt-1">{drive.role.title}</h1>
            <p className="type-meta mt-1 text-housing-muted">
              {editable ? "Editable until it goes live." : "Live, ended and cancelled drives can't be edited."}
            </p>
          </div>

          <VenueOutsideCityNotice drive={drive} />

          {drive.needsManualGeocode && (
            <p className="type-meta border-l-2 border-filling-lamp pl-3 text-stock">
              This address couldn&apos;t be placed on the map, so the venue pin sits at the city centre. Edit the address
              and save to try again.
            </p>
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
            <FieldGroup legend="Seats">
              <BoardField label="Total seats" hint="Slots were fixed when the drive was created.">
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
              {saved ? "Changes saved." : ""}
            </p>

            {editable && (
              <div>
                <BoardButton type="submit" disabled={loading}>
                  {loading ? "Saving" : "Save changes"}
                </BoardButton>
              </div>
            )}
          </form>
        </div>

        <aside className="grid content-start gap-6 lg:border-l lg:border-housing-line lg:pl-8" aria-label="Drive status and slots">
          <section className="grid gap-3">
            <h2 className="type-meta text-housing-muted">Status</h2>
            <StatusMark state={state} surface="housing" className="type-body" />
            {drive.status === "DRAFT" && (
              <BoardButton disabled={loading} onClick={() => run(() => apiClient.submitDrive(drive.id), "Couldn't send for review")}>
                Send for review
              </BoardButton>
            )}
            {drive.status === "LIVE" && (
              <>
                <Link href={`/employer/drives/${drive.id}/checkin`} className={boardButtonClass()}>
                  Open check-in screen
                </Link>
                <Link href={`/employer/drives/${drive.id}/applicants`} className={boardButtonClass("housing", "quiet")}>
                  Applicants
                </Link>
                <Link href={`/drives/${drive.id}`} className="type-meta text-stock underline underline-offset-4">
                  See the public page
                </Link>
              </>
            )}
            {editable && (
              <BoardButton variant="quiet" disabled={loading} onClick={handleCancel}>
                Cancel drive
              </BoardButton>
            )}
          </section>

          <section aria-labelledby="slots-heading">
            <h2 id="slots-heading" className="type-meta text-housing-muted">
              Slots
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
