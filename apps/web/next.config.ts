import type { NextConfig } from "next";
import { API_INTERNAL_URL } from "./lib/api-internal-url";

const nextConfig: NextConfig = {
  // Same-origin proxy to the API, so the browser needs no API address, no
  // CORS, and the refresh cookie belongs to the page's own origin.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_INTERNAL_URL}/:path*` }];
  },
};

export default nextConfig;
