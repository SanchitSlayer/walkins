import { Redis } from "ioredis";

// maxRetriesPerRequest must be null for BullMQ connections; it manages its own retry policy.
export const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});
