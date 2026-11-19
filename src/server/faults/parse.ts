/**
 * Parsing of `FAULT_INJECT`: a comma-separated list of `target:kind[:probability]` rules.
 * Pure (no env access), so `env.ts` can validate it.
 */

/** What each target can fail with. */
export const FAULT_KINDS = {
  /** 429 with retry-after, 5xx, 529 overloaded, connection error, malformed (invalid) output. */
  claude: ["429", "5xx", "529", "connection", "malformed"],
  /** Retryable 5xx / 429, non-retryable (`fatal`), timeout, job `lost` on the provider side. */
  provider: ["5xx", "429", "fatal", "timeout", "lost"],
  /** An S3 service error (HTTP 500). */
  s3: ["error"],
  /** A failed send. */
  email: ["fail"],
} as const;

export type FaultTarget = keyof typeof FAULT_KINDS;
export type FaultKind<T extends FaultTarget = FaultTarget> = (typeof FAULT_KINDS)[T][number];

export type FaultRule = {
  target: FaultTarget;
  kind: string;
  /** 0..1; omitted in the string means 1 (always). */
  probability: number;
};

export type FaultParseResult = { ok: true; rules: FaultRule[] } | { ok: false; error: string };

function isTarget(value: string): value is FaultTarget {
  return Object.prototype.hasOwnProperty.call(FAULT_KINDS, value);
}

export function parseFaultInject(raw: string): FaultParseResult {
  const rules: FaultRule[] = [];
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    const [target, kind, probabilityText, ...rest] = entry.split(":").map((s) => s.trim());
    if (!target || !kind || rest.length > 0) {
      return { ok: false, error: `expected target:kind[:probability], got "${entry}"` };
    }
    if (!isTarget(target)) {
      return {
        ok: false,
        error: `unknown target "${target}" (one of ${Object.keys(FAULT_KINDS).join(", ")})`,
      };
    }
    const kinds: readonly string[] = FAULT_KINDS[target];
    if (!kinds.includes(kind)) {
      return {
        ok: false,
        error: `unknown kind "${kind}" for ${target} (one of ${kinds.join(", ")})`,
      };
    }
    let probability = 1;
    if (probabilityText !== undefined) {
      probability = Number(probabilityText);
      if (
        probabilityText === "" ||
        !Number.isFinite(probability) ||
        probability < 0 ||
        probability > 1
      ) {
        return {
          ok: false,
          error: `probability must be a number from 0 to 1, got "${probabilityText}"`,
        };
      }
    }
    rules.push({ target, kind, probability });
  }
  return { ok: true, rules };
}
