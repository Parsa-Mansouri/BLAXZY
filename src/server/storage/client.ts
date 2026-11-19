import { S3Client } from "@aws-sdk/client-s3";
import { getEnv } from "@/server/env";
import { faultsEnabled, maybeFault } from "@/server/faults";
import { s3FaultError } from "@/server/faults/errors";

type FaultMiddleware = Parameters<S3Client["middlewareStack"]["addRelativeTo"]>[0];

let client: S3Client | undefined;
let presignClient: S3Client | undefined;

function createClient(endpoint: string, options: { faults: boolean }): S3Client {
  const env = getEnv();
  const s3 = new S3Client({
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
    // Explicit limits instead of SDK defaults: a hung store must fail the call so the queue can
    // retry it.
    // requestTimeout is the idle time of the socket, so long uploads and downloads that keep
    // moving are not cut off.
    maxAttempts: env.S3_MAX_ATTEMPTS,
    requestHandler: {
      connectionTimeout: env.S3_CONNECTION_TIMEOUT_MS,
      requestTimeout: env.S3_REQUEST_TIMEOUT_MS,
    },
  });
  if (options.faults) {
    // Fault injection (FAULT_INJECT=s3:..., dev/QA only): after the retry middleware, so the
    // SDK retries the injected 500 like a real one. Never added to the presigning client.
    // The SDK does not export the stack's generic handler types, hence the cast.
    const inject = ((next: (args: never) => Promise<unknown>) => async (args: never) => {
      if (maybeFault("s3")) throw s3FaultError();
      return next(args);
    }) as unknown as FaultMiddleware;
    s3.middlewareStack.addRelativeTo(inject, {
      name: "faultInjection",
      relation: "after",
      toMiddleware: "retryMiddleware",
    });
  }
  return s3;
}

/** Client for server-side calls (inside the container network: `S3_ENDPOINT`). */
export function getS3(): S3Client {
  client ??= createClient(getEnv().S3_ENDPOINT, { faults: faultsEnabled("s3") });
  return client;
}

/** Client used only to presign URLs for browsers (`S3_PUBLIC_ENDPOINT`, else `S3_ENDPOINT`). */
export function getPresignS3(): S3Client {
  const env = getEnv();
  presignClient ??= createClient(env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT, { faults: false });
  return presignClient;
}

export function getBucket(): string {
  return getEnv().S3_BUCKET;
}
