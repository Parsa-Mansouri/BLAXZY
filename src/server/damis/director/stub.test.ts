import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { ProjectStyle } from "@/server/db/schema";
import { sampleDirector } from "../sample/director";
import rawInput from "./fixtures/input.json";
import { blockExcerpts } from "./excerpts";
import { buildDirectorPrompt } from "./prompt";
import {
  directorInputSchema,
  directorPlanInputSchema,
  type DirectorOutput,
  type DirectorPlanOutput,
} from "./schema";
import { stubCreativeBible } from "./stub";
import { checkDirector, checkDirectorPlan } from "./validate";

const inputJson = rawInput as unknown as z.input<typeof directorInputSchema>;

const style: ProjectStyle = {
  visualStyle: "Handmade felt puppets",
  genre: "A bedtime fable",
  format: "movie",
  orientation: "portrait",
  totalDurationSeconds: 60,
  lookLine: "Wool and button eyes under warm lamplight.",
};

describe("stub Creative Bible (a project without a bible)", () => {
  const stub = stubCreativeBible(style);

  it("is honest: no module, no rules or guards, one assumption, ok_with_assumptions", () => {
    expect(stub.selection).toEqual({ genre_id: "genre.other", style_id: "style.other" });
    expect(stub.validation_status).toBe("ok_with_assumptions");
    expect(stub.assumptions).toHaveLength(1);
    expect(stub.slices.for_director.rules).toEqual([]);
    expect(stub.slices.for_text_blocks_video.rules).toEqual([]);
    expect(stub.anti_cliche_guards).toEqual([]);
    expect(stub.continuity_locks).toEqual([]);
    expect(stub.qc_checklist).toEqual([]);
    expect(stub.open_questions).toEqual([]);
  });

  it("takes the frame from the project style and keeps the user's own words in the contracts", () => {
    expect(stub.project_frame).toMatchObject({
      format: "film",
      orientation: "portrait",
      total_duration_sec: 60,
      block_length_sec: 15,
      script_language: null,
      dialogue_policy: null,
    });
    expect(stub.contracts.genre_contract).toContain("A bedtime fable");
    expect(stub.contracts.style_contract).toContain("Handmade felt puppets");
    expect(stub.contracts.style_contract).toContain("Wool and button eyes");
  });

  it("is accepted by the Director input and reaches the prompt with the owner's field list", () => {
    const input = directorInputSchema.parse({ ...inputJson, creative_bible: stub });
    const prompt = buildDirectorPrompt(input);
    const text = (prompt.messages[0]?.content ?? []).map((p) => (p as { text: string }).text);
    expect(text[0]).toContain("<creative_bible>");
    expect(text[0]).toContain("ok_with_assumptions");
    expect(text[0]).not.toContain("review_options");
  });

  it("the sample Director answers it in full and plan mode and passes its own checks", () => {
    const full = directorInputSchema.parse({ ...inputJson, creative_bible: stub });
    const output = sampleDirector(full) as DirectorOutput;
    expect(checkDirector(output, full)).toEqual([]);
    expect(output.blocks.length).toBeGreaterThan(0);
    const planInput = directorPlanInputSchema.parse({
      ...inputJson,
      mode: "plan",
      creative_bible: stub,
    });
    const plan = sampleDirector(planInput) as DirectorPlanOutput;
    expect(checkDirectorPlan(plan, planInput)).toEqual([]);
  });
});

describe("blockExcerpts", () => {
  const script =
    "INT. HALL - DAY\n\nMARA opens the door.\nShe waits.\n\nMARA\nCome in.\n\nJONAS steps inside.";

  it("returns the original text from the first quote to the last, line breaks kept", () => {
    expect(
      blockExcerpts(script, [
        { start_quote: "INT. HALL - DAY", end_quote: "She waits." },
        { start_quote: "MARA Come in.", end_quote: "JONAS steps inside." },
      ]),
    ).toEqual([
      "INT. HALL - DAY\n\nMARA opens the door.\nShe waits.",
      "MARA\nCome in.\n\nJONAS steps inside.",
    ]);
  });

  it("falls back to the joined quotes when a quote is not found, never empty", () => {
    const [excerpt] = blockExcerpts(script, [{ start_quote: "Nothing here", end_quote: "at all" }]);
    expect(excerpt).toBe("Nothing here … at all");
  });
});
