import { notFound } from "next/navigation";
import { getPublicDriveOnServer } from "@/lib/server-search";
import DriveMap from "@/components/leaflet/drive-map-loader";

export default async function DriveDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const drive = await getPublicDriveOnServer(id);

  if (!drive) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">{drive.role.title}</h1>
        <p className="text-sm text-muted-foreground">
          {drive.city.name}, {drive.city.state} &middot; {drive.distanceKm.toFixed(1)} km away
        </p>
        {drive.needsManualGeocode && (
          <p className="mt-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
            The venue map pin for this drive is approximate.
          </p>
        )}
      </div>

      <div className="grid gap-2 text-sm">
        <p>
          <span className="text-muted-foreground">Venue:</span> {drive.venueAddress}
        </p>
        <p>
          <span className="text-muted-foreground">When:</span> {new Date(drive.startsAt).toLocaleString("en-IN")}
          {" – "}
          {new Date(drive.endsAt).toLocaleString("en-IN")}
        </p>
        <p>
          <span className="text-muted-foreground">Salary:</span> {"₹"}
          {drive.salaryMin}
          {"–₹"}
          {drive.salaryMax}
        </p>
        <p>
          <span className="text-muted-foreground">Experience:</span> {drive.experienceMin}
          {"–"}
          {drive.experienceMax} years
        </p>
        <p>
          <span className="text-muted-foreground">Capacity:</span> {drive.capacity}
        </p>
      </div>

      <DriveMap drives={[drive]} />
    </main>
  );
}
