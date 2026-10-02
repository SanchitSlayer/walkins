import { type DriveDetail, haversineDistanceKm, MAX_TRAVEL_KM } from "@walkins/shared";

export function kmFromCity(drive: DriveDetail): number {
  return haversineDistanceKm(drive.city.centerLat, drive.city.centerLng, drive.venueLat, drive.venueLng);
}

// Stays up for as long as the venue sits outside its city, because none of
// what that breaks announces itself: alerts quietly reach nobody, the city
// map frames half the country, and check-ins at the real venue are refused.
export function VenueOutsideCityNotice({ drive }: { drive: DriveDetail }) {
  const km = kmFromCity(drive);
  if (km <= MAX_TRAVEL_KM) return null;
  return (
    <section aria-labelledby="venue-outside-heading" className="grid gap-2 border-l-4 border-closing-lamp bg-housing-raised p-4">
      <h2 id="venue-outside-heading" className="type-h3">
        Venue is outside {drive.city.name}
      </h2>
      <p className="type-body">
        The venue location is {Math.round(km).toLocaleString("en-IN")} km from the centre of {drive.city.name}, where this drive
        is listed. Alerts won&apos;t reach anyone, the {drive.city.name} map will show it far away, and check-ins at the real venue
        will be refused. Set the venue again from a device at the venue.
      </p>
    </section>
  );
}
