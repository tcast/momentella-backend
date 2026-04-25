/**
 * Vendor-neutral object storage helper. Works with any S3-compatible service:
 * Cloudflare R2 (recommended — free 10 GB tier, no egress), AWS S3, Backblaze
 * B2, MinIO, etc.
 *
 * Required env vars:
 *   S3_ENDPOINT          e.g. https://<accountid>.r2.cloudflarestorage.com
 *                        (omit for AWS S3 — it auto-resolves from S3_REGION)
 *   S3_BUCKET            bucket name
 *   S3_REGION            "auto" works for R2; AWS uses us-east-1, etc.
 *   S3_ACCESS_KEY_ID     access key
 *   S3_SECRET_ACCESS_KEY secret
 *   S3_PUBLIC_URL_BASE   public URL prefix returned to clients, with no
 *                        trailing slash. For R2 this is your r2.dev URL or
 *                        a custom domain like https://cdn.momentella.com
 */

import { randomBytes } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

let cached: { client: S3Client; bucket: string; publicBase: string } | null =
  null;

export interface ObjectStorageConfig {
  client: S3Client;
  bucket: string;
  publicBase: string;
}

export class ObjectStorageNotConfigured extends Error {
  constructor() {
    super(
      "Object storage is not configured. Set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_PUBLIC_URL_BASE (and S3_ENDPOINT for R2/B2/MinIO).",
    );
    this.name = "ObjectStorageNotConfigured";
  }
}

export function getObjectStorage(): ObjectStorageConfig {
  if (cached) return cached;
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  const publicBase = process.env.S3_PUBLIC_URL_BASE?.trim().replace(/\/$/, "");
  if (!bucket || !accessKeyId || !secretAccessKey || !publicBase) {
    throw new ObjectStorageNotConfigured();
  }
  const region = process.env.S3_REGION?.trim() || "auto";
  const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
  const client = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    // R2 + many S3 clones reject the AWS-style virtual-hosted bucket URL.
    // Path-style (https://endpoint/bucket/key) works everywhere.
    forcePathStyle: !!endpoint,
  });
  cached = { client, bucket, publicBase };
  return cached;
}

export function isObjectStorageConfigured(): boolean {
  try {
    getObjectStorage();
    return true;
  } catch {
    return false;
  }
}

const SAFE_EXT = /^[a-z0-9]{1,8}$/;

function pickExtension(filename: string, contentType: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot >= 0) {
    const ext = filename.slice(dot + 1).toLowerCase();
    if (SAFE_EXT.test(ext)) return ext;
  }
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  if (contentType === "image/svg+xml") return "svg";
  return "bin";
}

export interface UploadInput {
  body: Buffer;
  contentType: string;
  filename: string;
  /** Logical folder under the bucket — e.g. "pages", "intake-forms". */
  prefix?: string;
}

export interface UploadResult {
  key: string;
  url: string;
  bytes: number;
  contentType: string;
}

/**
 * Stores `body` under a randomly-named key and returns the publicly-readable URL.
 * Caller is responsible for permission / size / mimetype checks.
 */
export async function putObject(input: UploadInput): Promise<UploadResult> {
  const { client, bucket, publicBase } = getObjectStorage();
  const ext = pickExtension(input.filename, input.contentType);
  const id = randomBytes(12).toString("hex");
  const folder = (input.prefix ?? "uploads").replace(/(^\/|\/$)/g, "");
  const date = new Date();
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const key = `${folder}/${yyyy}/${mm}/${id}.${ext}`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: input.body,
      ContentType: input.contentType,
      // 1-year cache; the URL has random bytes, so it's safe to cache hard.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return {
    key,
    url: `${publicBase}/${key}`,
    bytes: input.body.length,
    contentType: input.contentType,
  };
}
