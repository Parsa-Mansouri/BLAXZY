/**
 * Test helpers: a scripted fake Claude client and an in-memory run store. Not exported from
 * the module's index; used by the *.test.ts files only.
 */
import type { StopReason } from "@anthropic-ai/sdk/resources/messages";
import type { ClaudeClient, ClaudeRequest, ClaudeResponse } from "./framework/client";
import { Semaphore } from "./framework/concurrency";
import type { DamiRunnerDeps } from "./framework/runner";
import type { DamiRunFinish, DamiRunStart, DamiRunStore } from "./framework/store";

export type FakeUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
};

export function fakeResponse(
  text: string,
  options: { stopReason?: StopReason; usage?: FakeUsage; model?: string } = {},
): ClaudeResponse {
  const usage = options.usage ?? {};
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: options.model ?? "claude-opus-5-5",
    container: null,
    diagnostics: null,
    content: [
      { type: "thinking", thinking: "", signature: "sig_fake" },
      { type: "text", text, citations: null },
    ],
    stop_reason: options.stopReason ?? "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: usage.input ?? 100,
      output_tokens: usage.output ?? 50,
      cache_read_input_tokens: usage.cacheRead ?? 0,
      cache_creation_input_tokens: usage.cacheWrite ?? 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
      speed: null,
    },
  };
}

export function jsonResponse(value: unknown, options?: Parameters<typeof fakeResponse>[1]) {
  return fakeResponse(JSON.stringify(value), options);
}

type Step = ClaudeResponse | Error | ((request: ClaudeRequest) => Promise<ClaudeResponse>);

/** Replays scripted steps in order; records every request and which method was used. */
export class FakeClaudeClient implements ClaudeClient {
  readonly requests: ClaudeRequest[] = [];
  readonly methods: Array<"create" | "stream"> = [];
  private readonly steps: Step[];

  constructor(steps: Step[]) {
    this.steps = [...steps];
  }

  createMessage(request: ClaudeRequest): Promise<ClaudeResponse> {
    this.methods.push("create");
    return this.next(request);
  }

  streamMessage(request: ClaudeRequest): Promise<ClaudeResponse> {
    this.methods.push("stream");
    return this.next(request);
  }

  private async next(request: ClaudeRequest): Promise<ClaudeResponse> {
    // Deep copy: the runner appends to its message list between attempts.
    this.requests.push(structuredClone(request));
    const step = this.steps.shift();
    if (!step) throw new Error("FakeClaudeClient: no scripted response left");
    if (step instanceof Error) throw step;
    if (typeof step === "function") return step(request);
    return step;
  }
}

export type StoredRun = DamiRunStart & { id: string; finish?: DamiRunFinish };

export class MemoryDamiRunStore implements DamiRunStore {
  readonly runs: StoredRun[] = [];

  async start(run: DamiRunStart): Promise<string> {
    const id = `run-${this.runs.length + 1}`;
    this.runs.push({ ...run, id });
    return id;
  }

  async finish(runId: string, result: DamiRunFinish): Promise<void> {
    const run = this.runs.find((r) => r.id === runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    run.finish = result;
  }
}

/** Deps that never touch the environment, the network or the database. */
export function testDeps(client: ClaudeClient, overrides: Partial<DamiRunnerDeps> = {}) {
  const store = new MemoryDamiRunStore();
  const sleeps: number[] = [];
  const deps: DamiRunnerDeps = {
    client,
    store,
    limiter: new Semaphore(4),
    config: { apiKey: undefined, defaultModel: undefined, maxConcurrency: 4, maxRetries: 3 },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
    ...overrides,
  };
  return { deps, store, sleeps };
}
