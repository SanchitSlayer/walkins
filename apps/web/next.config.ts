import type { NextConfig } from "next";
import { API_INTERNAL_URL } from "./lib/api-internal-url";

const MINIO_URL = `${process.env.MINIO_USE_SSL === "true" ? "https" : "http"}://${process.env.MINIO_ENDPOINT ?? "localhost"}:${process.env.MINIO_PORT ?? 9000}`;

const nextConfig: NextConfig = {
  // Same-origin proxy to the API, so the browser needs no API address, no
  // CORS, and the refresh cookie belongs to the page's own origin.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_INTERNAL_URL}/:path*` },
      // Socket.io's own path, trailing slash included: its server only
      // answers on "/socket.io/", which is why the redirect below is off.
      { source: "/socket.io/", destination: `${API_INTERNAL_URL}/socket.io/` },
      // Voice uploads and playback go straight to MinIO on presigned URLs.
      // The proxy forwards MinIO's own address as Host, which is what the
      // URLs were signed for.
      { source: "/storage/:path*", destination: `${MINIO_URL}/:path*` },
    ];
  },
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
