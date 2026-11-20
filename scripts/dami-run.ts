/**
 * Runs one dami for real against the Claude API and prints its output, tokens and cost.
 *
 *   pnpm dami:run <key> <input.json> [--project <projectId>] [--live]
 *
 * Example: pnpm dami:run script-writer src/server/damis/script-writer/fixtures/input.json
 * `director` (modes full and write_blocks) and `director-plan` read the fixtures in
 * `src/server/damis/director/fixtures` (set `mode` to `plan` for director-plan).
 * `film-director-card` (Mode A, writes a Director Style Card) reads
 * `src/server/damis/film-director/fixtures/card-input.json`; `film-director` reads `input.json`
 * there; `cinematographer` reads `look-input.json` or `scene-input.json` in its `fixtures`.
 * Needs ANTHROPIC_API_KEY and a reachable DATABASE_URL (the run is recorded in dami_run).
 * In live mode it makes PAID Claude calls and requires the explicit --live flag. Refuses to run
 * in production or against a non-local database (see assertDevOnly in scripts/_lib.ts).
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { project } from "@/server/db/schema";
import {
  DAMIS,
  DamiError,
  getDamiMode,
  runDami,
  type DamiRunContext,
  type TokenUsage,
} from "@/server/damis";
import { assertDevOnly, runScript } from "./_lib";

function usage(): never {
  console.error(
    `Usage: pnpm dami:run <key> <input.json> [--project <projectId>] [--live]\nDamis: ${Object.keys(DAMIS).join(", ")}`,
  );
  process.exit(2);
}

function parseArgs(argv: string[]): {
  key: string;
  file: string;
  projectId?: string;
  live: boolean;
} {
  const positional: string[] = [];
  let projectId: string | undefined;
  let live = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project") projectId = argv[++i] ?? usage();
    else if (arg === "--live") live = true;
    else if (arg && arg !== "--") positional.push(arg);
  }
  const [key, file] = positional;
  if (!key || !file) usage();
  return { key, file, projectId, live };
}

async function contextFor(projectId: string | undefined): Promise<DamiRunContext> {
  if (!projectId) return {};
  const [row] = await getDb()
    .select({ ownerId: project.ownerId })
    .from(project)
    .where(eq(project.id, projectId));
  if (!row) throw new Error(`Project ${projectId} not found`);
  return { projectId, userId: row.ownerId };
}

function printSummary(meta: {
  runIds: string[];
  model: string;
  usage: TokenUsage;
  costUsd: number | null;
  attempts?: number;
}) {
  const u = meta.usage;
  console.error(
    [
      "",
      `runs:    ${meta.runIds.join(", ")}`,
      `model:   ${meta.model}`,
      ...(meta.attempts === undefined ? [] : [`attempts: ${meta.attempts}`]),
      `tokens:  input ${u.inputTokens}, output ${u.outputTokens}, cache read ${u.cacheReadTokens}, cache write ${u.cacheWriteTokens}`,
      `cost:    ${meta.costUsd === null ? "unknown (no confirmed price for this model)" : `$${meta.costUsd.toFixed(6)}`}`,
    ].join("\n"),
  );
}

async function main() {
  assertDevOnly("dami:run");
  const { key, file, projectId, live } = parseArgs(process.argv.slice(2));
  const dami = DAMIS[key];
  if (!dami) usage();
  if (getDamiMode() === "live") {
    console.error("dami:run will make PAID Claude API calls (live mode).");
    if (!live) throw new Error("Refusing to make paid calls without --live.");
  }
  const input: unknown = JSON.parse(await readFile(file, "utf8"));
  const ctx = await contextFor(projectId);

  const result = await runDami(dami, input, ctx);
  console.log(JSON.stringify(result.output, null, 2));
  printSummary({ ...result, runIds: [result.runId] });
}

runScript(main, {
  onError: (error) => {
    if (error instanceof DamiError) {
      console.error(
        `\n${error.name} [${error.code}]${error.runId ? ` (run ${error.runId})` : ""}:`,
      );
      console.error(error.message);
    } else {
      console.error(error);
    }
  },
});
