import { Client, S3Error } from "minio";

const BUCKET = process.env.MINIO_BUCKET ?? "walkins-uploads";

const client = new Client({
  endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ROOT_USER ?? "",
  secretKey: process.env.MINIO_ROOT_PASSWORD ?? "",
});

export async function readObject(key: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await client.getObject(BUCKET, key)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

// Already gone counts as done: deleting is the goal either way.
export async function removeObject(key: string): Promise<void> {
  try {
    await client.removeObject(BUCKET, key);
  } catch (err) {
    if (!(err instanceof S3Error && err.code === "NoSuchKey")) throw err;
  }
}

export async function listObjects(prefix: string): Promise<{ key: string; lastModified: Date }[]> {
  const objects: { key: string; lastModified: Date }[] = [];
  for await (const item of client.listObjectsV2(BUCKET, prefix, true)) {
    if (item.name) objects.push({ key: item.name, lastModified: item.lastModified });
  }
  return objects;
}
