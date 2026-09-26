import { notFound } from "next/navigation";
import { Masthead } from "@/components/board/masthead";
import { getPublicDriveOnServer } from "@/lib/server-search";
import DriveDetailClient from "./drive-detail-client";

export default async function DriveDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const drive = await getPublicDriveOnServer(id);

  if (!drive) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-housing text-stock">
      <Masthead context={`${drive.city.name}, ${drive.city.state}`} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <DriveDetailClient initial={drive} renderedAt={Date.now()} />
      </main>
    </div>
  );
}
