import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { localeAlternates } from "@walkins/shared";
import { Masthead } from "@/components/board/masthead";
import { getCityCenterByName, searchDrivesOnServer } from "@/lib/server-search";
import JobsSearchClient from "../jobs-search-client";

type SearchParams = { radiusKm?: string; fromDate?: string; toDate?: string; cursor?: string };
type Params = Promise<{ city: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { city } = await params;
  const cityRow = await getCityCenterByName(city);
  if (!cityRow) return {};
  const t = await getTranslations("jobs.meta");
  return {
    alternates: localeAlternates(`/jobs/${city}`, await getLocale()),
    title: t("cityTitle", { city: cityRow.name }),
    description: t("cityDescription", { city: cityRow.name, state: cityRow.state }),
  };
}

export default async function JobsByCityPage({ params, searchParams }: { params: Params; searchParams: Promise<SearchParams> }) {
  const { city } = await params;
  const query = await searchParams;

  const cityRow = await getCityCenterByName(city);
  if (!cityRow) {
    notFound();
  }

  const t = await getTranslations("jobs");
  const initialData = await searchDrivesOnServer({ city, ...query });

  return (
    <div className="min-h-screen bg-housing text-stock">
      <Masthead context={t("cityContext", { city: cityRow.name, state: cityRow.state })} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <JobsSearchClient
          city={city}
          heading={t("cityHeading", { city: cityRow.name })}
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
