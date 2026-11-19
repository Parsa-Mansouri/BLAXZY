import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { getBucket, getS3 } from "./client";

/**
 * Resolves when the bucket answers a HeadBucket (readiness; cheap, reads no object), throws
 * otherwise. `signal` bounds the request.
 */
export async function pingBucket(signal: AbortSignal): Promise<void> {
  await getS3().send(new HeadBucketCommand({ Bucket: getBucket() }), { abortSignal: signal });
}
