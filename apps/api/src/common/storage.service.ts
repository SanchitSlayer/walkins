import { Injectable } from "@nestjs/common";
import { Client, S3Error } from "minio";

const BUCKET = process.env.MINIO_BUCKET ?? "walkins-uploads";

// Browsers reach MinIO through the web app's same-origin /storage proxy (so
// no CORS, and no plain-HTTP request from an HTTPS page on a phone). The proxy
// sends MinIO its own address as Host, so URLs are signed for that address
// and handed out as the proxy path. Files never pass through the API.
const PROXY_PREFIX = "/storage";

@Injectable()
export class StorageService {
  private readonly client = new Client({
    endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
    port: Number(process.env.MINIO_PORT ?? 9000),
    useSSL: process.env.MINIO_USE_SSL === "true",
    accessKey: process.env.MINIO_ROOT_USER ?? "",
    secretKey: process.env.MINIO_ROOT_PASSWORD ?? "",
  });

  // A POST policy rather than a presigned PUT, because a policy lets MinIO
  // itself refuse a file over the size limit; a PUT URL can't carry one.
  async presignUpload(key: string, contentType: string, maxBytes: number): Promise<{ url: string; fields: Record<string, string> }> {
    const policy = this.client.newPostPolicy();
    policy.setBucket(BUCKET);
    policy.setKey(key);
    policy.setContentType(contentType);
    policy.setContentLengthRange(1, maxBytes);
    policy.setExpires(new Date(Date.now() + 10 * 60_000));
    const { formData } = await this.client.presignedPostPolicy(policy);
    return { url: `${PROXY_PREFIX}/${BUCKET}`, fields: formData };
  }

  async size(key: string): Promise<number | null> {
    try {
      return (await this.client.statObject(BUCKET, key)).size;
    } catch (err) {
      if (err instanceof S3Error && err.code === "NotFound") return null;
      throw err;
    }
  }

  async presignPlayback(key: string): Promise<string> {
    const signed = new URL(await this.client.presignedGetObject(BUCKET, key, 5 * 60));
    return `${PROXY_PREFIX}${signed.pathname}${signed.search}`;
  }
}
