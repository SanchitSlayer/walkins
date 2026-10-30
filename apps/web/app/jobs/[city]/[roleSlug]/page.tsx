import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { localeAlternates } from "@walkins/shared";
import { Masthead } from "@/components/board/masthead";
import { getCityCenterByName, getRoleBySlugOnServer, searchDrivesOnServer } from "@/lib/server-search";
import JobsSearchClient from "../../jobs-search-client";

type SearchParams = { radiusKm?: string; fromDate?: string; toDate?: string; cursor?: string };
type Params = Promise<{ city: string; roleSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { city, roleSlug } = await params;
  const [cityRow, role] = await Promise.all([getCityCenterByName(city), getRoleBySlugOnServer(roleSlug)]);
  if (!cityRow || !role) return {};
  const t = await getTranslations("jobs.meta");
  return {
    alternates: localeAlternates(`/jobs/${city}/${roleSlug}`, await getLocale()),
    title: t("roleTitle", { role: role.title, city: cityRow.name }),
    description: t("roleDescription", { role: role.title, city: cityRow.name, state: cityRow.state }),
  };
}

export default async function JobsByCityAndRolePage({ params, searchParams }: { params: Params; searchParams: Promise<SearchParams> }) {
  const { city, roleSlug } = await params;
  const query = await searchParams;

  const [cityRow, role] = await Promise.all([getCityCenterByName(city), getRoleBySlugOnServer(roleSlug)]);
  if (!cityRow || !role) {
    notFound();
  }

  const t = await getTranslations("jobs");
  const initialData = await searchDrivesOnServer({ city, role: roleSlug, ...query });

  return (
    <div className="min-h-screen bg-housing text-stock">
      <Masthead context={t("cityContext", { city: cityRow.name, state: cityRow.state })} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <JobsSearchClient
          city={city}
          roleSlug={roleSlug}
          heading={t("roleHeading", { role: role.title, city: cityRow.name })}
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
