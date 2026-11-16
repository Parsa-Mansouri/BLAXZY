/**
 * Test helper: wraps the services that need `expectedCredits` so a test that is about something
 * else (a flow, a handler) need not quote by hand. The wrapper tries the sample provider's prices
 * for the four purposes until the service accepts one (a refused attempt creates nothing). A test
 * about the confirmation itself passes `expectedCredits` explicitly (even `undefined`), which
 * the wrapper leaves alone.
 */
import { isPriceChanged, quoteGeneration } from "../generation";
import type { ProjectStyle } from "../db/schema";

/** Any style quotes the same (prices depend on the purpose). Not imported from the script fixtures:
 * those pull in vitest, and the dev scripts use this module too. */
const TEST_STYLE: ProjectStyle = {
  visualStyle: "Cinematic live-action",
  genre: "Drama",
  format: "movie",
  orientation: "landscape",
  totalDurationSeconds: 90,
};

let cached: Promise<number[]> | undefined;

/** The distinct prices of look, sheet, draft and final in the active (sample) provider. */
function prices(): Promise<number[]> {
  cached ??= Promise.all(
    (["asset_look", "asset_sheet", "block_draft", "block_final"] as const).map(
      async (purpose) => (await quoteGeneration({ purpose, style: TEST_STYLE })).priceCredits,
    ),
  ).then((all) => [...new Set(all)]);
  return cached;
}

/** `module` with the functions named in `names` confirming their price on their own. */
export function autoConfirm<M extends object>(module: M, names: readonly string[]): M {
  const wrapped = { ...module } as Record<string, unknown>;
  for (const name of names) {
    const original = wrapped[name];
    if (typeof original !== "function") throw new Error(`autoConfirm: ${name} is not a function`);
    wrapped[name] = async (input: Record<string, unknown>, ...rest: unknown[]) => {
      if ("expectedCredits" in input) return original(input, ...rest);
      let refused: unknown;
      for (const price of await prices()) {
        try {
          return await original({ ...input, expectedCredits: price }, ...rest);
        } catch (error) {
          if (!isPriceChanged(error)) throw error;
          refused = error;
        }
      }
      throw refused;
    };
  }
  return wrapped as M;
}

export const ASSET_SPEND_FUNCTIONS = [
  "startDesign",
  "startLookFromPrompt",
  "startLookFromGuided",
  "answerLookQuestion",
  "retryLook",
  "retrySheet",
  "retrySheetView",
  "submitLookReview",
  "submitSheetReview",
  "submitSheetViewReview",
] as const;

export const PRODUCTION_SPEND_FUNCTIONS = [
  "submitTakeReview",
  "retryTake",
  "updateShotForHandoff",
  "requestNextShotUpdate",
] as const;
