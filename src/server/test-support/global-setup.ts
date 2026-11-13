/**
 * Vitest global setup: probes Postgres (and that migrations are applied), the S3 bucket and
 * ffmpeg once, applies the safety guards and provides the result to the integration test files
 * (see `integration.ts`).
 *
 * Policy
 * - `SKIP_INTEGRATION=1`: integration tests are skipped on purpose.
 * - `CI` or `REQUIRE_INTEGRATION=1`: anything missing fails the whole run.
 * - Otherwise missing services skip the integration tests and one summary line says what and why.
 * - A non-local database or S3 host is refused (hard failure, never a silent skip) unless
 *   `ALLOW_REMOTE_TEST_DB=1`. `TEST_DATABASE_URL` replaces DATABASE_URL (see vitest.config.mts).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import "dotenv/config";
import { Client } from "pg";
import type { TestProject } from "vitest/node";
import { ffmpegAvailable } from "../providers/ffmpeg";
import type { IntegrationStatus } from "./integration";
import { hostOfUrl, isLocalHost } from "./local-host";

const truthy = (value: string | undefined) => value === "1" || value === "true";
const message = (error: unknown) => {
  if (!(error instanceof Error)) return String(error);
  const code = (error as { code?: unknown }).code;
  return error.message || (typeof code === "string" ? code : error.name);
};

async function probeDatabase(url: string): Promise<string | null> {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
  } catch (error) {
    return `Postgres unreachable (${message(error)})`;
  }
  try {
    const journal = JSON.parse(
      readFileSync(resolve(process.cwd(), "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: { when: number; tag: string }[] };
    const newest = journal.entries.at(-1);
    if (!newest) return null;
    let applied: string | null;
    try {
      const { rows } = await client.query<{ m: string | null }>(
        "select max(created_at)::text as m from drizzle.__drizzle_migrations",
      );
      applied = rows[0]?.m ?? null;
    } catch {
      return "database has no migrations table: run `pnpm db:migrate`";
    }
    if (applied === null || Number(applied) < newest.when) {
      return `migrations not up to date (newest is ${newest.tag}): run \`pnpm db:migrate\``;
    }
    return null;
  } catch (error) {
    return `could not check migrations (${message(error)})`;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function probeS3(): Promise<string | null> {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    const missing = Object.entries({
      S3_ENDPOINT,
      S3_BUCKET,
      S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY,
    })
      .filter(([, v]) => !v)
      .map(([k]) => k);
    return `S3 variables not set: ${missing.join(", ")}`;
  }
  const s3 = new S3Client({
    endpoint: S3_ENDPOINT,
    region: process.env.S3_REGION ?? "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    maxAttempts: 1,
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }), {
      abortSignal: AbortSignal.timeout(3000),
    });
    return null;
  } catch (error) {
    return `S3 bucket "${S3_BUCKET}" unreachable (${message(error)})`;
  } finally {
    s3.destroy();
  }
}

export default async function setup(project: TestProject): Promise<void> {
  const strict = Boolean(process.env.CI) || truthy(process.env.REQUIRE_INTEGRATION);
  const status: IntegrationStatus = { database: false, s3: false, ffmpeg: false, reasons: [] };

  if (truthy(process.env.SKIP_INTEGRATION)) {
    status.reasons.push("SKIP_INTEGRATION=1");
    project.provide("integration", status);
    console.warn(
      "[integration] SKIPPED on purpose (SKIP_INTEGRATION=1): integration tests skipped.",
    );
    return;
  }

  const problems: string[] = [];
  const unsafe: string[] = [];

  // Safety guard: never run (and hard-delete) against a non-local database or object store.
  const dbUrl = process.env.DATABASE_URL;
  const allowRemote = truthy(process.env.ALLOW_REMOTE_TEST_DB);
  if (!dbUrl) {
    problems.push("DATABASE_URL is not set (no .env?)");
  } else if (!allowRemote && !isLocalHost(hostOfUrl(dbUrl))) {
    unsafe.push(
      `DATABASE_URL host "${hostOfUrl(dbUrl) ?? "unparseable"}" is not local: set TEST_DATABASE_URL to a local database, or ALLOW_REMOTE_TEST_DB=1`,
    );
  }
  const s3Endpoint = process.env.S3_ENDPOINT;
  if (s3Endpoint && !allowRemote && !isLocalHost(hostOfUrl(s3Endpoint))) {
    unsafe.push(
      `S3_ENDPOINT host "${hostOfUrl(s3Endpoint) ?? "unparseable"}" is not local: use the local store, or ALLOW_REMOTE_TEST_DB=1`,
    );
  }
  if (unsafe.length > 0) {
    throw new Error(`Refusing to run integration tests:\n  - ${unsafe.join("\n  - ")}`);
  }

  if (dbUrl) {
    const dbProblem = await probeDatabase(dbUrl);
    if (dbProblem) problems.push(dbProblem);
    else status.database = true;
  }
  const s3Problem = await probeS3();
  if (s3Problem) problems.push(s3Problem);
  else status.s3 = true;
  status.ffmpeg = await ffmpegAvailable();
  if (!status.ffmpeg) {
    problems.push("ffmpeg not found (FFMPEG_PATH, ffmpeg-static or PATH): video tests");
  }

  if (problems.length > 0 && strict) {
    throw new Error(
      `Integration prerequisites missing (CI or REQUIRE_INTEGRATION=1 makes this fatal):\n  - ${problems.join("\n  - ")}`,
    );
  }
  status.reasons = problems;
  project.provide("integration", status);
  if (problems.length > 0) {
    const skipped = [
      !status.database || !status.s3 ? "integration tests needing Postgres and S3" : null,
      !status.ffmpeg ? "ffmpeg-dependent video tests" : null,
    ].filter((s): s is string => s !== null);
    console.warn(
      `[integration] SKIPPED ${skipped.join(" and ")}: ${problems.join("; ")}. ` +
        "Set REQUIRE_INTEGRATION=1 to make this a failure.",
    );
  }
}
