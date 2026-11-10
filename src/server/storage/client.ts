import { S3Client } from "@aws-sdk/client-s3";
import { getEnv } from "@/server/env";

let client: S3Client | undefined;
let presignClient: S3Client | undefined;

function createClient(endpoint: string): S3Client {
  const env = getEnv();
  return new S3Client({
    endpoint,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    // Otherwise the SDK signs a CRC32 of the (empty) request body into presigned PUT URLs, which
    // stores that verify checksums reject, and adds checksum work most S3 servers do not need.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/** Client for server-side calls (inside the container network: `S3_ENDPOINT`). */
export function getS3(): S3Client {
  client ??= createClient(getEnv().S3_ENDPOINT);
  return client;
}

/** Client used only to presign URLs for browsers (`S3_PUBLIC_ENDPOINT`, else `S3_ENDPOINT`). */
export function getPresignS3(): S3Client {
  const env = getEnv();
  presignClient ??= createClient(env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT);
  return presignClient;
}

export function getBucket(): string {
  return getEnv().S3_BUCKET;
}
