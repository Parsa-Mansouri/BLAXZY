import { describe, expect, it, vi } from "vitest";
import type { ActionResult } from "./action";
import {
  MAX_ATTEMPTS,
  PRICE_CHANGED_NOTICE,
  PRICE_KEEPS_CHANGING,
  runSpendFlow,
  type FlowQuote,
} from "./spend-flow";

type Result = { ok: true; data: null } | { ok: false; error: string; priceChanged?: true };

function setup(overrides: {
  quote?: Partial<FlowQuote>;
  choice?: { confirmed: boolean; dontAskAgain: boolean };
  results?: Result[];
}) {
  const quote: FlowQuote = {
    spends: true,
    credits: 4,
    balance: 100,
    skip: false,
    ...overrides.quote,
  };
  const results = [...(overrides.results ?? [{ ok: true, data: null } as Result])];
  const ask = vi.fn(async () => overrides.choice ?? { confirmed: true, dontAskAgain: false });
  const saveSkip = vi.fn(async () => undefined);
  const submit = vi.fn(async (): Promise<Result> => results.shift() ?? { ok: true, data: null });
  const readQuote = vi.fn(async (): Promise<ActionResult<FlowQuote>> => ({
    ok: true,
    data: quote,
  }));
  return {
    ask,
    saveSkip,
    submit,
    readQuote,
    run: () => runSpendFlow({ quote: readQuote, ask, saveSkip, submit }),
  };
}

describe("runSpendFlow", () => {
  it("asks, then submits with the price the user saw", async () => {
    const t = setup({});
    expect(await t.run()).toEqual({ ok: true, data: null });
    expect(t.ask).toHaveBeenCalledTimes(1);
    expect(t.submit).toHaveBeenCalledWith(4);
    expect(t.saveSkip).not.toHaveBeenCalled();
  });

  it("does nothing when the user cancels", async () => {
    const t = setup({ choice: { confirmed: false, dontAskAgain: false } });
    expect(await t.run()).toBeNull();
    expect(t.submit).not.toHaveBeenCalled();
  });

  it("saves the choice when Do not ask again is ticked and confirmed", async () => {
    const t = setup({ choice: { confirmed: true, dontAskAgain: true } });
    await t.run();
    expect(t.saveSkip).toHaveBeenCalledTimes(1);
    expect(t.submit).toHaveBeenCalledWith(4);
  });

  it("does not save it when the user cancels with the tick on", async () => {
    const t = setup({ choice: { confirmed: false, dontAskAgain: true } });
    await t.run();
    expect(t.saveSkip).not.toHaveBeenCalled();
  });

  it("skips the dialog when the user turned it off, still sending the current price", async () => {
    const t = setup({ quote: { skip: true, credits: 6 } });
    expect(await t.run()).toEqual({ ok: true, data: null });
    expect(t.ask).not.toHaveBeenCalled();
    expect(t.submit).toHaveBeenCalledWith(6);
  });

  it("asks anyway when the balance does not cover the price", async () => {
    const t = setup({ quote: { skip: true, credits: 6, balance: 2 } });
    await t.run();
    expect(t.ask).toHaveBeenCalledTimes(1);
  });

  it("asks again with the new price when the server says it changed, even with the dialog off", async () => {
    const t = setup({
      quote: { skip: true },
      results: [
        { ok: false, error: "The price changed.", priceChanged: true },
        { ok: true, data: null },
      ],
    });
    expect(await t.run()).toEqual({ ok: true, data: null });
    expect(t.readQuote).toHaveBeenCalledTimes(2);
    expect(t.ask).toHaveBeenCalledTimes(1);
    expect(t.ask).toHaveBeenCalledWith(expect.anything(), PRICE_CHANGED_NOTICE);
    expect(t.submit).toHaveBeenCalledTimes(2);
  });

  it("gives up when the price keeps changing", async () => {
    const changed: Result = { ok: false, error: "x", priceChanged: true };
    const t = setup({ results: Array.from({ length: MAX_ATTEMPTS }, () => changed) });
    expect(await t.run()).toEqual({ ok: false, error: PRICE_KEEPS_CHANGING });
    expect(t.submit).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("returns other failures as they are, without asking again", async () => {
    const t = setup({ results: [{ ok: false, error: "Nope." }] });
    expect(await t.run()).toEqual({ ok: false, error: "Nope." });
    expect(t.ask).toHaveBeenCalledTimes(1);
  });

  it("submits at once, without asking, when the step costs nothing", async () => {
    const t = setup({ quote: { spends: false, credits: 0 } });
    await t.run();
    expect(t.ask).not.toHaveBeenCalled();
    expect(t.submit).toHaveBeenCalledWith(0);
  });

  it("returns the failure when the price cannot be read", async () => {
    const t = setup({});
    t.readQuote.mockResolvedValueOnce({ ok: false, error: "Gone." });
    expect(await t.run()).toEqual({ ok: false, error: "Gone." });
    expect(t.submit).not.toHaveBeenCalled();
  });
});
