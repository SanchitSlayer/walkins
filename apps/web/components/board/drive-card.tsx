import type { DriveSearchResult } from "@walkins/shared";
import { formatDistance, formatSalary, formatSeats, formatWhen } from "@/lib/board-format";
import { deriveBoardState, StatusMark } from "./board-state";
import { Slab } from "./slab";

export function DriveCard({ drive, now, selected = false }: { drive: DriveSearchResult; now: Date; selected?: boolean }) {
  const state = deriveBoardState(drive, now);
  const when = formatWhen(drive.startsAt, drive.endsAt, now);

  return (
    <Slab href={`/drives/${drive.id}`} state={state} depth={selected ? "lg" : "md"} selected={selected} className="w-full">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="type-h3">{drive.role.title}</h3>
        <span className="type-board-md shrink-0 whitespace-nowrap">{formatDistance(drive.distanceKm)}</span>
      </div>
      <p className="type-meta text-ink-muted">{drive.venueAddress}</p>
      <p className="type-board-md mt-3">
        <span className="whitespace-nowrap">{when.day}</span>
        {" · "}
        <span className="whitespace-nowrap">{when.time}</span>
      </p>
      <p className="type-board-md whitespace-nowrap">{formatSalary(drive.salaryMin, drive.salaryMax)}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <StatusMark state={state} surface="stock" />
        {state !== "expired" && state !== "cancelled" && (
          <span className="type-board-sm whitespace-nowrap text-ink-muted">
            {formatSeats(drive.capacity, drive.bookedCount)}
          </span>
        )}
      </div>
    </Slab>
  );
}
