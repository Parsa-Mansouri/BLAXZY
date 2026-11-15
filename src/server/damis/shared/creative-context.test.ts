import { describe, expect, it } from "vitest";
import outputJson from "../creative-dna/fixtures/model-output.json";
import { CREATIVE_REGISTRY, getCreativeModule } from "../creative-dna/registry";
import { creativeBibleSchema } from "../creative-dna/schema";
import {
  CREATIVE_CONSUMERS,
  getReviewOptions,
  QC_STAGE,
  renderCreativeDna,
  type CreativeConsumer,
} from "./creative-context";

const bible = creativeBibleSchema.parse(outputJson);

describe("renderCreativeDna", () => {
  it("is one cached block with the owner's sections in order", () => {
    const block = renderCreativeDna("director", bible);
    expect(block.cache).toBe(true);
    const tags = [
      "<creative_dna ",
      "<shared_core>",
      "<genre_specialization>",
      "<style_specialization>",
      "<contracts>",
      "<project_frame>",
      "<project_rules>",
      "<never_add>",
      "<continuity_locks>",
      "<self_check_before_output>",
      "</creative_dna>",
    ];
    let at = -1;
    for (const tag of tags) {
      const next = block.text.indexOf(tag);
      expect(next, tag).toBeGreaterThan(at);
      at = next;
    }
    expect(
      block.text.startsWith(
        '<creative_dna version="1.0" genre="genre.drama" style="style.realistic">',
      ),
    ).toBe(true);
  });

  it("includes the shared core and both specializations verbatim", () => {
    const { text } = renderCreativeDna("script_writer", bible);
    expect(text).toContain(CREATIVE_REGISTRY.shared_core_en);
    expect(text).toContain(getCreativeModule("genre.drama").specialization_en);
    expect(text).toContain(getCreativeModule("style.realistic").specialization_en);
  });

  it("gives each consumer its own rules and no other slice's", () => {
    const writer = renderCreativeDna("script_writer", bible).text;
    const director = renderCreativeDna("director", bible).text;
    for (const rule of bible.slices.for_script_writer.rules) {
      expect(writer).toContain(`- ${rule.rule}`);
    }
    expect(writer).not.toContain(`- ${bible.slices.for_director.rules[0]?.rule}`);
    expect(director).toContain(`- ${bible.slices.for_director.rules[0]?.rule}`);
    expect(director).not.toContain(`- ${bible.slices.for_script_writer.rules[0]?.rule}`);
  });

  it("adds the slice's extra fields as tags, and series rules to the script writer's rules", () => {
    const writer = renderCreativeDna("script_writer", bible).text;
    expect(writer).toContain(
      `<beat_guidance>\n${JSON.stringify(bible.slices.for_script_writer.beat_guidance)}\n</beat_guidance>`,
    );
    expect(writer).not.toContain("<series_rules>");
    const series = structuredClone(bible);
    series.slices.for_script_writer.series_rules = [
      { id: "sw_series_01", rule: "Each episode has its own unit of change.", source: "frame" },
    ];
    expect(renderCreativeDna("script_writer", series).text).toContain(
      "- Each episode has its own unit of change.",
    );
    expect(renderCreativeDna("director", series).text).not.toContain("own unit of change");
    const detector = renderCreativeDna("asset_detector", bible).text;
    expect(detector).toContain("<attributes_to_capture>");
  });

  it("lists every guard and lock, and only the QC items of the consumer's stages", () => {
    const assets = renderCreativeDna("asset_generation", bible).text;
    for (const g of bible.anti_cliche_guards) expect(assets).toContain(`- ${g.guard}`);
    for (const lock of bible.continuity_locks) expect(assets).toContain(`- ${lock}`);
    const check = assets.slice(assets.indexOf("<self_check_before_output>"));
    for (const q of bible.qc_checklist) {
      const wanted = QC_STAGE.asset_generation.includes(q.stage);
      expect(check.includes(`- ${q.criterion}`), q.id).toBe(wanted);
    }
  });

  it("maps every consumer to its stages", () => {
    expect(QC_STAGE).toEqual({
      script_writer: ["script", "all"],
      script_checker: ["script", "all"],
      asset_detector: ["asset", "all"],
      asset_generation: ["asset", "all"],
      sheet_generator: ["sheet", "all"],
      director: ["text_block", "video", "all"],
      text_blocks_video: ["text_block", "video", "all"],
    });
    const consumers: readonly CreativeConsumer[] = CREATIVE_CONSUMERS;
    for (const consumer of consumers) {
      expect(renderCreativeDna(consumer, bible).text).toContain("<project_rules>");
    }
  });
});

describe("getReviewOptions", () => {
  it("returns the technical and preference options of a review point", () => {
    const options = getReviewOptions(bible, "video");
    expect(options).toBe(bible.review_options.video);
    expect(options.technical.length).toBeGreaterThanOrEqual(4);
  });
});
