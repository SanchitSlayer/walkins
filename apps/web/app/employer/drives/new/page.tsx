"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createDriveSchema } from "@walkins/shared";
import { apiClient } from "@/lib/api-client";
import { BoardButton, BoardField, BoardInput, boardButtonClass } from "@/components/board/field";
import { DriveFields, type DriveFieldValues, EMPTY_DRIVE_FIELDS, FieldGroup, parseDriveFields } from "../drive-fields";

// Mirrors the API's rule: the window must divide evenly into slots.
function slotCount(startsAt: string, endsAt: string, slotMinutes: number): number | null {
  const minutes = (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000;
  if (!(minutes > 0) || !(slotMinutes > 0) || minutes % slotMinutes !== 0) return null;
  return minutes / slotMinutes;
}

export default function NewDrivePage() {
  const router = useRouter();
  const [fields, setFields] = useState<DriveFieldValues>(EMPTY_DRIVE_FIELDS);
  const [slotDurationMinutes, setSlotDurationMinutes] = useState("60");
  const [capacityPerSlot, setCapacityPerSlot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const slots = slotCount(fields.startsAt, fields.endsAt, Number(slotDurationMinutes));
  const perSlot = Number(capacityPerSlot);
  const capacity = slots !== null && perSlot > 0 ? slots * perSlot : null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (fields.startsAt && fields.endsAt && slots === null) {
      setError(`The time between doors open and close must divide evenly into ${slotDurationMinutes}-minute slots.`);
      return;
    }

    const parsed = createDriveSchema.safeParse({
      ...parseDriveFields(fields),
      capacity: capacity ?? 0,
      slotDurationMinutes: Number(slotDurationMinutes),
      capacityPerSlot: perSlot,
    });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? "A field is missing or invalid");
      return;
    }

    setLoading(true);
    try {
      const drive = await apiClient.createDrive(parsed.data);
      router.push(`/employer/drives/${drive.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the drive");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid max-w-3xl gap-6">
      <div>
        <Link href="/employer/drives" className="type-meta text-housing-muted underline-offset-4 hover:underline">
          Drives
        </Link>
        <h1 className="type-h2 mt-1">New drive</h1>
        <p className="type-meta mt-1 text-housing-muted">Saved as a draft. You can check it over before sending it for review.</p>
      </div>

      <form className="grid gap-6" onSubmit={handleSubmit} noValidate>
        <DriveFields values={fields} onChange={(key, value) => setFields((f) => ({ ...f, [key]: value }))} />

        <FieldGroup legend="Slots">
          <BoardField label="Slot length (minutes)">
            <BoardInput
              board
              type="number"
              inputMode="numeric"
              min={1}
              value={slotDurationMinutes}
              onChange={(e) => setSlotDurationMinutes(e.target.value)}
            />
          </BoardField>
          <BoardField label="Seats per slot">
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
              ? `${slots} ${slots === 1 ? "slot" : "slots"} × ${perSlot} seats = ${capacity} seats in total`
              : fields.startsAt && fields.endsAt && slots === null
                ? `The window doesn't divide into ${slotDurationMinutes}-minute slots`
                : "Total seats are worked out from the window and slot length"}
          </p>
        </FieldGroup>

        {error && (
          <p role="alert" className="type-meta text-closing-lamp">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <BoardButton type="submit" disabled={loading}>
            {loading ? "Creating drive" : "Create draft"}
          </BoardButton>
          <Link href="/employer/drives" className={boardButtonClass("housing", "quiet")}>
            Discard
          </Link>
        </div>
      </form>
    </div>
  );
}
