import { Masthead } from "@/components/board/masthead";
import { Slab } from "@/components/board/slab";
import { listCitiesOnServer } from "@/lib/server-search";

export default async function Home() {
  const cities = await listCitiesOnServer();

  return (
    <div className="min-h-screen bg-housing text-stock">
      <Masthead />
      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-20">
        <h1 className="type-display max-w-3xl">Walk-in interviews near you</h1>
        <p className="type-body mt-4 max-w-xl text-housing-muted">
          No application, no waiting to hear back. Pick your city, see who&apos;s interviewing and when, and turn up.
        </p>

        <h2 className="type-h3 mt-12">Choose a city</h2>
        {cities.length === 0 ? (
          <p className="type-body mt-4 text-housing-muted">The board can&apos;t reach the server right now. Try again shortly.</p>
        ) : (
          <ul className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {cities.map((city) => (
              <li key={city.id}>
                <Slab href={`/jobs/${city.name.toLowerCase()}`} depth="lg" className="w-full">
                  <span className="type-h2 block">{city.name}</span>
                  <span className="type-meta block text-ink-muted">{city.state}</span>
                  <span className="type-board-md mt-4 block">See drives</span>
                </Slab>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
