import { notFound } from "next/navigation";
import { Masthead } from "@/components/board/masthead";
import { getCityCenterByName, searchDrivesOnServer } from "@/lib/server-search";
import JobsSearchClient from "../../jobs-search-client";

type SearchParams = { radiusKm?: string; fromDate?: string; toDate?: string; cursor?: string };

export default async function JobsByCityAndRolePage({
  params,
  searchParams,
}: {
  params: Promise<{ city: string; roleSlug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { city, roleSlug } = await params;
  const query = await searchParams;

  const cityRow = await getCityCenterByName(city);
  if (!cityRow) {
    notFound();
  }

  const initialData = await searchDrivesOnServer({ city, role: roleSlug, ...query });
  const roleLabel = roleSlug.replace(/-/g, " ");

  return (
    <div className="min-h-screen bg-housing text-stock">
      <Masthead context={`${cityRow.name}, ${cityRow.state}`} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <JobsSearchClient
          city={city}
          roleSlug={roleSlug}
          heading={`${roleLabel.charAt(0).toUpperCase()}${roleLabel.slice(1)} drives in ${cityRow.name}`}
          initialData={initialData}
          cityCenter={{ lat: cityRow.centerLat, lng: cityRow.centerLng }}
          initialRadiusKm={query.radiusKm}
          initialFromDate={query.fromDate}
          initialToDate={query.toDate}
          renderedAt={Date.now()}
        />
      </main>
    </div>
  );
}
