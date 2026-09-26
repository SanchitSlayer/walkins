import L from "leaflet";
import icon from "leaflet/dist/images/marker-icon.png";
import iconRetina from "leaflet/dist/images/marker-icon-2x.png";
import shadow from "leaflet/dist/images/marker-shadow.png";

// Leaflet's default marker icon resolves image URLs relative to its own
// CSS file, which breaks under any bundler (webpack/Next included) unless
// the URLs are pointed at the bundled asset paths explicitly.
let patched = false;

export function fixDefaultIcon() {
  if (patched) return;
  patched = true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconUrl: icon.src,
    iconRetinaUrl: iconRetina.src,
    shadowUrl: shadow.src,
  });
}
