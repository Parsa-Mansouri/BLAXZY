import { describe, expect, it } from "vitest";
import { DAMIS } from "../index";
import { SAMPLE_GENERATORS } from "./client";

describe("sample generators", () => {
  it("every registered dami has a sample generator", () => {
    for (const key of Object.keys(DAMIS)) expect(SAMPLE_GENERATORS[key]).toBeTypeOf("function");
  });
});
