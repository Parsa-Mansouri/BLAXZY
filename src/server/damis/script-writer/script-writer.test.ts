import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { partText } from "../framework/define";
import { runDami } from "../framework/runner";
import { sampleScriptOutline } from "../sample/script-writer";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import {
  checkOutline,
  checkScreenplay,
  scriptOutliner,
  scriptWriter,
  writerMaxTokens,
} from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { SCRIPT_WRITER_CORE, SCRIPT_WRITER_GENRES, SCRIPT_WRITER_STYLES } from "./modules";
import { genreModule, moduleSlots, styleModule } from "./prompt";
import {
  issueTypeFor,
  WRITER_PREFERENCE_REASONS,
  WRITER_REASONS,
  WRITER_TECHNICAL_REASONS,
} from "./reasons";
import {
  scriptOutlineInputSchema,
  scriptWriterInputSchema,
  submitScreenplaySchema,
} from "./schema";

const input = scriptWriterInputSchema.parse(inputJson);
const output = submitScreenplaySchema.parse(outputJson);
const source = readFileSync(
  join(__dirname, "source", "dami_script_writer_v0.2.md"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("script-writer v0.2", () => {
  it("copies the owner's core, genre and style modules verbatim", () => {
    expect(source).toContain(SCRIPT_WRITER_CORE);
    expect(Object.keys(SCRIPT_WRITER_GENRES)).toEqual([
      "Drama",
      "Comedy",
      "Horror",
      "Thriller",
      "Action",
      "Science Fiction",
    ]);
    expect(Object.keys(SCRIPT_WRITER_STYLES)).toEqual([
      "Realistic",
      "Noir",
      "Futuristic",
      "Horror Visual Style",
      "3D Animation",
      "Anime",
      "Claymation",
    ]);
    for (const text of [
      ...Object.values(SCRIPT_WRITER_GENRES),
      ...Object.values(SCRIPT_WRITER_STYLES),
    ]) {
      expect(source).toContain(text);
    }
    // The module slots follow the core exactly as the owner wrote them.
    const slots = moduleSlots({ genre: "Drama", visualStyle: "Noir" });
    expect(slots.startsWith("<genre_module>\nGENRE: Drama")).toBe(true);
    expect(source).toContain(
      "<genre_module>\n{{GENRE_MODULE}}\n</genre_module>\n\n<style_module>\n{{STYLE_MODULE}}\n</style_module>",
    );
  });

  it("lists the owner's 19 reason codes split technical and preference", () => {
    expect(WRITER_TECHNICAL_REASONS).toHaveLength(10);
    expect(WRITER_PREFERENCE_REASONS).toHaveLength(9);
    expect(WRITER_REASONS.every((r) => r.label && r.instruction)).toBe(true);
    for (const code of [...WRITER_TECHNICAL_REASONS, ...WRITER_PREFERENCE_REASONS]) {
      expect(source).toContain(`\`${code}\``);
    }
    expect(issueTypeFor(["simplify", "too_long"])).toBe("technical");
    expect(issueTypeFor(["simplify"])).toBe("preference");
  });

  it("fixture output parses and passes the checks", () => {
    expect(checkScreenplay(output, input)).toEqual([]);
  });

  it("runs end to end with a fake client, streaming, on Opus", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson)]);
    const result = await runDami(scriptWriter, input, {}, testDeps(client).deps);
    expect(result.output).toEqual(output);
    expect(client.methods).toEqual(["stream"]);
    expect(client.requests[0]?.model).toBe("claude-opus-5-5");
  });

  it("builds the owner's template: core and modules cached, the story verbatim, no format text", () => {
    const prompt = scriptWriter.build(input);
    expect(prompt.system.map((p) => p.cache)).toEqual([true, true]);
    expect(prompt.system[0]?.text).toBe(SCRIPT_WRITER_CORE);
    expect(prompt.system[1]?.text).toContain(SCRIPT_WRITER_GENRES.Drama);
    expect(prompt.system[1]?.text).toContain(SCRIPT_WRITER_STYLES.Realistic);
    const user = partText(prompt.messages[0]?.content[0]);
    expect(user).toContain("<mode>generate</mode>");
    expect(user).toContain("<format>film</format>");
    expect(user).toContain("<scene_count_range>1-3</scene_count_range>");
    expect(user).toContain(
      "<story>\nTwo old lovers meet again on the last ferry of the night.\n</story>",
    );
    expect(user).not.toMatch(/portrait|landscape|orientation/i);
  });

  it("falls back to a module in the owner's format for a typed genre or style", () => {
    expect(genreModule("Mockumentary")).toMatch(/^GENRE: Mockumentary/);
    expect(styleModule("Watercolour")).toMatch(/^VISUAL STYLE: Watercolour/);
  });

  it("renders the revise feedback block", () => {
    const revise = scriptWriterInputSchema.parse({
      mode: "revise",
      project: inputJson.project,
      previousScreenplay: outputJson.screenplay,
      feedback: {
        issueType: "technical",
        selectedReasons: ["unclear_action", "too_long"],
        customNote: "Scene 2 is unclear.",
        scope: [2],
      },
    });
    const user = partText(scriptWriter.build(revise).messages[0]?.content[0]);
    expect(user).toContain("<issue_type>technical</issue_type>");
    expect(user).toContain("<selected_reasons>unclear_action, too_long</selected_reasons>");
    expect(user).toContain("<scope>2</scope>");
    expect(checkScreenplay(output, revise)).toContain(
      "change_log is required in revise mode: one entry per change",
    );
  });

  it("flags sums that disagree and dialogue without a speaker", () => {
    const broken = structuredClone(output);
    broken.screenplay.estimated_duration_seconds = 99;
    broken.screenplay.scenes[0]?.elements.push({ type: "dialogue", text: "Who?" });
    const issues = checkScreenplay(broken, input);
    expect(issues.some((i) => i.includes("add up to 58"))).toBe(true);
    expect(issues.some((i) => i.includes("speaker"))).toBe(true);
  });

  it("checks that outline targets add up", () => {
    const outlineInput = scriptOutlineInputSchema.parse({
      project: { ...inputJson.project, targetDurationSeconds: 1800 },
      story: "A courier crosses a city that keeps moving.",
    });
    const outline = sampleScriptOutline(outlineInput);
    expect(checkOutline(outline, outlineInput)).toEqual([]);
    expect(outline.acts.flatMap((a) => a.sequences).every((s) => s.target_seconds <= 480)).toBe(
      true,
    );
    const broken = structuredClone(outline);
    const act = broken.acts[0];
    if (act) act.target_seconds += 10;
    expect(checkOutline(broken, outlineInput).length).toBeGreaterThan(0);
    expect(scriptOutliner.key).toBe("script-writer-outline");
  });

  it("sizes max_tokens by the owner's guide", () => {
    expect(writerMaxTokens(60)).toBe(8000);
    expect(writerMaxTokens(600)).toBe(16000);
  });
});
