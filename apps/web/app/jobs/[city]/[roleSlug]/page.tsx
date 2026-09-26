import { notFound } from "next/navigation";
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
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-lg font-semibold capitalize">
        {roleLabel} drives in {cityRow.name}, {cityRow.state}
      </h1>
      <JobsSearchClient
        city={city}
        roleSlug={roleSlug}
        initialData={initialData}
        cityCenter={{ lat: cityRow.centerLat, lng: cityRow.centerLng }}
        initialRadiusKm={query.radiusKm}
        initialFromDate={query.fromDate}
        initialToDate={query.toDate}
      />
    </main>
  );
}
