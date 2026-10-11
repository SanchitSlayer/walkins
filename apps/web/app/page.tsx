import { Masthead } from "@/components/board/masthead";
import { Slab } from "@/components/board/slab";
import { listCitiesOnServer } from "@/lib/server-search";
import { getTranslations } from "next-intl/server";

export default async function Home() {
  const t = await getTranslations("home");
  const cities = await listCitiesOnServer();

  return (
    <div className="min-h-screen bg-housing text-stock">
      <Masthead />
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-20">
        <h1 className="type-display max-w-3xl">{t("heading")}</h1>
        <p className="type-body mt-4 max-w-xl text-housing-muted">{t("intro")}</p>

        <h2 className="type-h3 mt-12">{t("chooseCity")}</h2>
        {cities.length === 0 ? (
          <p className="type-body mt-4 text-housing-muted">{t("unreachable")}</p>
        ) : (
          <ul className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {cities.map((city) => (
              <li key={city.id}>
                <Slab href={`/jobs/${city.name.toLowerCase()}`} depth="lg" className="w-full">
                  <span className="type-h2 block">{city.name}</span>
                  <span className="type-meta block text-ink-muted">{city.state}</span>
                  <span className="type-board-md mt-4 block">{t("seeDrives")}</span>
                </Slab>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
