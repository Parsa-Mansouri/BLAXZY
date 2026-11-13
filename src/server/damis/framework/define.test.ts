import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { defineDami, type DamiResult } from "./define";

const base = {
  key: "test-define",
  version: "0.0.1",
  description: "Test",
  input: z.object({}),
  output: z.object({ n: z.number() }),
  maxOutputTokens: 100,
  build: () => ({ system: [{ text: "s" }], messages: [] }),
};

describe("defineDami overloads", () => {
  it("without finalize the result type is the validated output", () => {
    const d = defineDami(base);
    expectTypeOf<DamiResult<typeof d>>().toEqualTypeOf<{ n: number }>();
    expect(d.finalize({ n: 1 }, {})).toEqual({ n: 1 });
  });

  it("with finalize the result type comes from it", () => {
    const d = defineDami({ ...base, finalize: (o) => ({ doubled: o.n * 2 }) });
    expectTypeOf<DamiResult<typeof d>>().toEqualTypeOf<{ doubled: number }>();
    expect(d.finalize({ n: 2 }, {})).toEqual({ doubled: 4 });
  });

  it("rejects an explicit result type without finalize", () => {
    // @ts-expect-error R cannot be given without a finalize that produces it
    defineDami<typeof base.input, typeof base.output, string>(base);
  });
});
