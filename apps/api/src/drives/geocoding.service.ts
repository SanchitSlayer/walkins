import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { redis } from "../common/redis";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "WalkinsInterviewPlatform/1.0 (college project; local dev use)";
const GEOCODE_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

export type GeocodedPoint = { lat: number; lng: number };

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private lastCallAt = 0;
  private queue: Promise<void> = Promise.resolve();

  async geocode(address: string): Promise<GeocodedPoint | null> {
    const cacheKey = `geocode:${this.hashAddress(address)}`;

    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as GeocodedPoint;
    }

    const point = await this.fetchFromNominatim(address);
    if (point) {
      await redis.set(cacheKey, JSON.stringify(point), "EX", GEOCODE_CACHE_TTL_SECONDS);
    }
    return point;
  }

  private async fetchFromNominatim(address: string): Promise<GeocodedPoint | null> {
    try {
      await this.throttle();

      const url = new URL(NOMINATIM_URL);
      url.searchParams.set("format", "json");
      url.searchParams.set("q", address);
      url.searchParams.set("limit", "1");

      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        this.logger.warn(`Nominatim responded ${response.status}`);
        return null;
      }

      const results = (await response.json()) as Array<{ lat: string; lon: string }>;
      const first = results[0];
      if (!first) {
        return null;
      }

      return { lat: Number(first.lat), lng: Number(first.lon) };
    } catch (error) {
      this.logger.warn(`Geocoding failed: ${(error as Error).message}`);
      return null;
    }
  }

  private hashAddress(address: string): string {
    return createHash("sha256").update(address.trim().toLowerCase()).digest("hex");
  }

  // Serializes all calls (across concurrent requests in this process)
  // through a single chain so no two Nominatim calls fire within 1s of
  // each other, per Nominatim's usage policy.
  private async throttle(): Promise<void> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;

    const elapsed = Date.now() - this.lastCallAt;
    const wait = Math.max(0, 1000 - elapsed);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastCallAt = Date.now();
    release();
  }
}
