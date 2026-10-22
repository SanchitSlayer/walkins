"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createDriveSchema } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, BoardField, BoardInput, boardButtonClass } from "@/components/board/field";
import { DriveFields, type DriveFieldValues, EMPTY_DRIVE_FIELDS, FieldGroup, parseDriveFields } from "../drive-fields";
import { type KnockoutDraft, KnockoutEditor, knockoutQuestions, useDriveIssue } from "../knockout-editor";
import { OutcomesPrompt } from "@/components/outcomes-prompt";
import { useTranslations } from "next-intl";
import { useErrorText } from "@/lib/use-error-text";

// Mirrors the API's rule: the window must divide evenly into slots.
function slotCount(startsAt: string, endsAt: string, slotMinutes: number): number | null {
  const minutes = (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000;
  if (!(minutes > 0) || !(slotMinutes > 0) || minutes % slotMinutes !== 0) return null;
  return minutes / slotMinutes;
}

export default function NewDrivePage() {
  const t = useTranslations("newDrive");
  const errorText = useErrorText();
  const driveIssue = useDriveIssue();
  const router = useRouter();
  const [fields, setFields] = useState<DriveFieldValues>(EMPTY_DRIVE_FIELDS);
  const [slotDurationMinutes, setSlotDurationMinutes] = useState("60");
  const [capacityPerSlot, setCapacityPerSlot] = useState("");
  const [knockouts, setKnockouts] = useState<KnockoutDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const slots = slotCount(fields.startsAt, fields.endsAt, Number(slotDurationMinutes));
  const perSlot = Number(capacityPerSlot);
  const capacity = slots !== null && perSlot > 0 ? slots * perSlot : null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (fields.startsAt && fields.endsAt && slots === null) {
      setError(t("uneven", { minutes: slotDurationMinutes }));
      return;
    }

    const parsed = createDriveSchema.safeParse({
      ...parseDriveFields(fields),
      capacity: capacity ?? 0,
      slotDurationMinutes: Number(slotDurationMinutes),
      capacityPerSlot: perSlot,
      knockoutQuestions: knockoutQuestions(knockouts),
    });
    if (!parsed.success) {
      setError(driveIssue(parsed.error.errors[0]));
      return;
    }

    setLoading(true);
    try {
      const drive = await apiClient.createDrive(parsed.data);
      router.push(`/employer/drives/${drive.id}`);
    } catch (err) {
      setError(errorText(err, "newDrive.createFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <Link href="/employer/drives" className="type-meta text-housing-muted underline-offset-4 hover:underline">
          {t("back")}
        </Link>
        <h1 className="type-h2 mt-1">{t("heading")}</h1>
        <p className="type-meta mt-1 text-housing-muted">{t("intro")}</p>
      </div>
      <OutcomesPrompt />

      <form className="grid gap-6" onSubmit={handleSubmit} noValidate>
        <DriveFields values={fields} onChange={(key, value) => setFields((f) => ({ ...f, [key]: value }))} />

        <FieldGroup legend={t("slots")}>
          <BoardField label={t("slotLength")}>
            <BoardInput
              board
              type="number"
              inputMode="numeric"
              min={1}
              value={slotDurationMinutes}
              onChange={(e) => setSlotDurationMinutes(e.target.value)}
            />
          </BoardField>
          <BoardField label={t("seatsPerSlot")}>
            <BoardInput
              board
              type="number"
              inputMode="numeric"
              min={1}
              value={capacityPerSlot}
              onChange={(e) => setCapacityPerSlot(e.target.value)}
            />
          </BoardField>
          <p className="type-board-md sm:col-span-2" aria-live="polite">
            {capacity !== null
              ? t("total", { slots: slots ?? 0, perSlot, capacity })
              : fields.startsAt && fields.endsAt && slots === null
                ? t("windowUneven", { minutes: slotDurationMinutes })
                : t("totalHint")}
          </p>
        </FieldGroup>

        <KnockoutEditor drafts={knockouts} onChange={setKnockouts} />

        {error && (
          <p role="alert" className="type-meta text-closing-lamp">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <BoardButton type="submit" disabled={loading}>
            {loading ? t("creating") : t("create")}
          </BoardButton>
          <Link href="/employer/drives" className={boardButtonClass("housing", "quiet")}>
            {t("discard")}
          </Link>
        </div>
      </form>
    </div>
  );
}
