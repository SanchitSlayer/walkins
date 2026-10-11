import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { formatFor } from "@walkins/shared";
import { Masthead } from "@/components/board/masthead";
import { getPublicDriveOnServer } from "@/lib/server-search";
import DriveDetailClient from "./drive-detail-client";

type Params = Promise<{ id: string }>;

// The drive's own facts, in words a search result can show: absolute dates,
// because "Tomorrow" goes stale the moment the page is indexed.
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const drive = await getPublicDriveOnServer((await params).id);
  if (!drive) return {};
  const [t, format] = await Promise.all([getTranslations("drive.meta"), getLocale().then(formatFor)]);
  return {
    title: t("title", { role: drive.role.title, city: drive.city.name }),
    description: t("description", {
      date: format.formatDate(new Date(drive.startsAt)),
      time: format.formatWhen(drive.startsAt, drive.endsAt, new Date(0)).time,
      venue: drive.venueAddress,
      pay: format.formatSalary(drive.salaryMin, drive.salaryMax),
    }),
  };
}

export default async function DriveDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const drive = await getPublicDriveOnServer(id);

  if (!drive) {
    notFound();
  }

  const t = await getTranslations("jobs");
  return (
    <div className="min-h-screen bg-housing text-stock">
      <Masthead context={t("cityContext", { city: drive.city.name, state: drive.city.state })} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <DriveDetailClient initial={drive} renderedAt={Date.now()} />
      </main>
    </div>
  );
}
