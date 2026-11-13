/**
 * Runs the runner against the real local Postgres (`docker compose up -d`, `pnpm db:migrate`)
 * with a fake Claude client. Skipped automatically when DATABASE_URL is missing or unreachable.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { databaseReachable } from "@/server/test-support/integration";
import writerInputJson from "../script-writer/fixtures/input.json";
import writerOutput from "../script-writer/fixtures/model-output.json";
import { scriptWriterInputSchema } from "../script-writer/schema";
import { FakeClaudeClient, jsonResponse } from "../test-utils";

const writerInput = scriptWriterInputSchema.parse(writerInputJson);

const reachable = await databaseReachable();

describe.skipIf(!reachable)("runDami (integration)", async () => {
  const { getDb, closeDb } = await import("@/server/db/client");
  const { damiRun, project, user } = await import("@/server/db/schema");
  const { createDrizzleDamiRunStore } = await import("./store");
  const { Semaphore } = await import("./concurrency");
  const { runDami } = await import("./runner");
  const { scriptWriter } = await import("../script-writer/dami");
  const { DamiApiError } = await import("./errors");
  const { BadRequestError } = await import("@anthropic-ai/sdk");

  const db = getDb();
  const userId = `it-dami-${randomUUID()}`;
  const runIds: string[] = [];
  await db.insert(user).values({ id: userId, name: "Dami IT", email: `${userId}@example.test` });
  const [createdProject] = await db
    .insert(project)
    .values({ ownerId: userId, title: "Dami IT project" })
    .returning({ id: project.id });
  const projectId = createdProject?.id ?? "";

  const deps = (client: FakeClaudeClient) => ({
    client,
    store: createDrizzleDamiRunStore(db),
    limiter: new Semaphore(2),
    config: { apiKey: undefined, defaultModel: undefined, maxConcurrency: 2, maxRetries: 0 },
    sleep: async () => undefined,
  });

  afterAll(async () => {
    if (runIds.length > 0) await db.delete(damiRun).where(inArray(damiRun.id, runIds));
    await db.delete(project).where(eq(project.id, projectId));
    await db.delete(user).where(eq(user.id, userId));
    await closeDb();
  });

  it("writes a complete dami_run row for a successful run", async () => {
    const client = new FakeClaudeClient([
      jsonResponse(writerOutput, {
        usage: { input: 1200, output: 900, cacheRead: 5000, cacheWrite: 2500 },
      }),
    ]);
    const result = await runDami(scriptWriter, writerInput, { userId, projectId }, deps(client));
    runIds.push(result.runId);

    const [row] = await db.select().from(damiRun).where(eq(damiRun.id, result.runId));
    expect(row).toMatchObject({
      damiKey: "script-writer",
      damiVersion: scriptWriter.version,
      model: "claude-opus-5-5",
      status: "succeeded",
      userId,
      projectId,
      attempts: 1,
      inputTokens: 1200,
      outputTokens: 900,
      cacheReadTokens: 5000,
      cacheWriteTokens: 2500,
      error: null,
    });
    // 1200*4 + 900*20 + 5000*0.2 + 2500*5 = 36300 per million
    expect(row?.costUsd).toBe("0.036300");
    expect(row?.input).toEqual(writerInput);
    expect(row?.output).toEqual(writerOutput);
    expect(row?.startedAt).toBeInstanceOf(Date);
    expect(row?.finishedAt).toBeInstanceOf(Date);
  });

  it("records a failed run with its error", async () => {
    const client = new FakeClaudeClient([
      new BadRequestError(400, { error: { type: "invalid_request_error" } }, "bad", new Headers()),
    ]);
    const error = await runDami(
      scriptWriter,
      writerInput,
      { userId, projectId },
      deps(client),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DamiApiError);
    const runId = (error as InstanceType<typeof DamiApiError>).runId ?? "";
    runIds.push(runId);

    const [row] = await db.select().from(damiRun).where(eq(damiRun.id, runId));
    expect(row?.status).toBe("failed");
    expect(row?.attempts).toBe(1);
    expect(row?.error).toContain("DamiApiError");
    expect(row?.output).toBeNull();
    expect(row?.inputTokens).toBeNull();
    expect(row?.costUsd).toBeNull();
    expect(row?.finishedAt).toBeInstanceOf(Date);
  });
});
