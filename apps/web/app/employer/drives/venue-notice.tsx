import { type DriveDetail, haversineDistanceKm, MAX_TRAVEL_KM } from "@walkins/shared";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/format";

export function kmFromCity(drive: DriveDetail): number {
  return haversineDistanceKm(drive.city.centerLat, drive.city.centerLng, drive.venueLat, drive.venueLng);
}

// Stays up for as long as the venue sits outside its city, because none of
// what that breaks announces itself: alerts quietly reach nobody, the city
// map frames half the country, and check-ins at the real venue are refused.
export function VenueOutsideCityNotice({ drive }: { drive: DriveDetail }) {
  const t = useTranslations("driveForm.outsideCity");
  const { formatNumber } = useFormat();
  const km = kmFromCity(drive);
  if (km <= MAX_TRAVEL_KM) return null;
  return (
    <section aria-labelledby="venue-outside-heading" className="grid gap-2 border-l-4 border-closing-lamp bg-housing-raised p-4">
      <h2 id="venue-outside-heading" className="type-h3">
        {t("heading", { city: drive.city.name })}
      </h2>
      <p className="type-body">{t("body", { km: formatNumber(Math.round(km)), city: drive.city.name })}</p>
    </section>
  );
}
