/**
 * Fault injection for development and QA (never production). `FAULT_INJECT` lists rules such as
 * `claude:429:0.3,provider:5xx:1,email:fail:1` (see `parse.ts`); the hook points call
 * `maybeFault(target)` and, when it returns a kind, throw the error the real dependency would.
 * With the variable unset every call returns null immediately. `FAULT_SEED` makes the dice
 * deterministic.
 */
import { parseFaultInject, type FaultKind, type FaultRule, type FaultTarget } from "./parse";

export { FAULT_KINDS, parseFaultInject } from "./parse";
export type { FaultKind, FaultRule, FaultTarget } from "./parse";

type State = { rules: FaultRule[]; random: () => number };

let state: State | undefined;

/** mulberry32: a tiny seeded generator. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function load(): State {
  if (state) return state;
  const raw = process.env.FAULT_INJECT?.trim();
  // Never active in production, whatever the environment holds (env validation also rejects it).
  if (!raw || process.env.NODE_ENV === "production") {
    state = { rules: [], random: Math.random };
    return state;
  }
  const parsed = parseFaultInject(raw);
  if (!parsed.ok) throw new Error(`Invalid FAULT_INJECT: ${parsed.error}`);
  const seed = process.env.FAULT_SEED?.trim();
  state = {
    rules: parsed.rules,
    random: seed ? seededRandom(Number(seed)) : Math.random,
  };
  return state;
}

/** True when any rule targets `target` (a cheap check for wrappers that can skip all work). */
export function faultsEnabled(target: FaultTarget): boolean {
  return load().rules.some((r) => r.target === target);
}

/**
 * Rolls the rules of `target` in order and returns the kind of the first that fires, else null.
 * Zero cost when nothing is configured.
 */
export function maybeFault<T extends FaultTarget>(target: T): FaultKind<T> | null {
  const { rules, random } = load();
  if (rules.length === 0) return null;
  for (const rule of rules) {
    if (rule.target !== target) continue;
    if (rule.probability >= 1 || random() < rule.probability) return rule.kind as FaultKind<T>;
  }
  return null;
}

/** Tests: replace the rules (and the dice); call `resetFaults()` afterwards. */
export function setFaultsForTest(rules: FaultRule[], random: () => number = Math.random): void {
  state = { rules, random };
}

export function resetFaults(): void {
  state = undefined;
}
