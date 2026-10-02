import type { NextConfig } from "next";
import { API_INTERNAL_URL } from "./lib/api-internal-url";

const nextConfig: NextConfig = {
  // Same-origin proxy to the API, so the browser needs no API address, no
  // CORS, and the refresh cookie belongs to the page's own origin.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_INTERNAL_URL}/:path*` },
      // Socket.io's own path, trailing slash included: its server only
      // answers on "/socket.io/", which is why the redirect below is off.
      { source: "/socket.io/", destination: `${API_INTERNAL_URL}/socket.io/` },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
