"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DriveSummary } from "@/lib/api-client";
import { apiClient } from "@/lib/api-client";
import { useRequireEmployer } from "@/lib/use-require-employer";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STATUS_BADGE: Record<DriveSummary["status"], BadgeProps["variant"]> = {
  DRAFT: "secondary",
  PENDING: "warning",
  LIVE: "success",
  EXPIRED: "outline",
  CANCELLED: "destructive",
};

export default function EmployerDrivesPage() {
  const ready = useRequireEmployer();
  const [drives, setDrives] = useState<DriveSummary[]>([]);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentCursor = cursorStack[cursorStack.length - 1];

  const load = useCallback(async (cursor: string | undefined) => {
    setLoading(true);
    setError(null);
    try {
      const page = await apiClient.listMyDrives(cursor);
      setDrives(page.items);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load drives");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) {
      load(currentCursor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, currentCursor]);

  if (!ready) {
    return null;
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Your drives</h1>
        <Link href="/employer/drives/new">
          <Button>New drive</Button>
        </Link>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

      {!loading && drives.length === 0 && (
        <p className="text-sm text-muted-foreground">No drives yet. Create your first one.</p>
      )}

      <ul className="space-y-3">
        {drives.map((drive) => (
          <li key={drive.id}>
            <Link
              href={`/employer/drives/${drive.id}`}
              className="flex items-center justify-between rounded-lg border border-border p-4 hover:bg-accent"
            >
              <div>
                <p className="font-medium">{drive.role.title}</p>
                <p className="text-sm text-muted-foreground">
                  {drive.venueAddress} · {new Date(drive.startsAt).toLocaleString()}
                </p>
                {drive.needsManualGeocode && (
                  <p className="text-xs text-amber-700">Coordinates need manual entry</p>
                )}
              </div>
              <Badge variant={STATUS_BADGE[drive.status]}>{drive.status}</Badge>
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex justify-between">
        <Button
          variant="outline"
          disabled={cursorStack.length <= 1}
          onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={!nextCursor}
          onClick={() => nextCursor && setCursorStack((stack) => [...stack, nextCursor])}
        >
          Next
        </Button>
      </div>
    </main>
  );
}
