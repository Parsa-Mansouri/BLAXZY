import { describe, expect, it } from "vitest";
import { splitPrompt } from "./prompt-tokens";

describe("splitPrompt", () => {
  it("returns plain text as one segment", () => {
    expect(splitPrompt("A quiet pier.")).toEqual([{ type: "text", text: "A quiet pier." }]);
  });

  it("splits text around tokens in order", () => {
    expect(splitPrompt("<<<image_1>>> walks past <<<image_2>>>, slowly.")).toEqual([
      { type: "image", index: 1, token: "<<<image_1>>>" },
      { type: "text", text: " walks past " },
      { type: "image", index: 2, token: "<<<image_2>>>" },
      { type: "text", text: ", slowly." },
    ]);
  });

  it("handles an empty prompt", () => {
    expect(splitPrompt("")).toEqual([]);
  });
});
