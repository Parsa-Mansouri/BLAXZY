import { describe, expect, it } from "vitest";
import outputJson from "../creative-dna/fixtures/model-output.json";
import { creativeBibleSchema } from "../creative-dna/schema";
import { characterGenerator } from "../character-generator/dami";
import characterInput from "../character-generator/fixtures/input.json";
import { partText, type DamiPrompt } from "../framework/define";
import { countBreakpoints } from "../framework/request";
import { locationGenerator } from "../location-generator/dami";
import locationInput from "../location-generator/fixtures/input.json";
import { propGenerator } from "../prop-generator/dami";
import propInput from "../prop-generator/fixtures/input.json";
import { scriptChecker } from "../script-checker/dami";
import checkerInput from "../script-checker/fixtures/input.json";
import { scriptOutliner, scriptWriter } from "../script-writer/dami";
import writerInput from "../script-writer/fixtures/input.json";
import { sheetGeneratorCharacter } from "../sheet-generator-character/dami";
import characterSheetInput from "../sheet-generator-character/fixtures/input.json";
import { sheetGeneratorLocation } from "../sheet-generator-location/dami";
import locationSheetInput from "../sheet-generator-location/fixtures/input.json";
import { sheetGeneratorProp } from "../sheet-generator-prop/dami";
import propSheetInput from "../sheet-generator-prop/fixtures/input.json";
import { renderCreativeDna, type CreativeConsumer } from "./creative-context";

const bible = creativeBibleSchema.parse(outputJson);

type Case = {
  name: string;
  consumer: CreativeConsumer;
  /** Builds the prompt from the fixture input, with the given `creativeDna` (or none). */
  build: (creativeDna?: string) => DamiPrompt;
  version: string;
};

/** The fixture input with `creativeDna` set only when given (an absent key, like the worker). */
function withDna<T extends object>(input: T, creativeDna: string | undefined) {
  return creativeDna ? { ...input, creativeDna } : input;
}

const outlineInput = {
  project: writerInput.project,
  story: "Two old lovers meet again on the last ferry of the night.",
};

const CASES: Case[] = [
  {
    name: "script-writer (generate)",
    consumer: "script_writer",
    build: (d) => scriptWriter.build(scriptWriter.input.parse(withDna(writerInput, d))),
    version: scriptWriter.version,
  },
  {
    name: "script-writer-outline",
    consumer: "script_writer",
    build: (d) => scriptOutliner.build(scriptOutliner.input.parse(withDna(outlineInput, d))),
    version: scriptOutliner.version,
  },
  {
    name: "script-checker",
    consumer: "script_checker",
    build: (d) => scriptChecker.build(scriptChecker.input.parse(withDna(checkerInput, d))),
    version: scriptChecker.version,
  },
  {
    name: "character-generator",
    consumer: "asset_generation",
    build: (d) =>
      characterGenerator.build(characterGenerator.input.parse(withDna(characterInput, d))),
    version: characterGenerator.version,
  },
  {
    name: "location-generator",
    consumer: "asset_generation",
    build: (d) => locationGenerator.build(locationGenerator.input.parse(withDna(locationInput, d))),
    version: locationGenerator.version,
  },
  {
    name: "prop-generator",
    consumer: "asset_generation",
    build: (d) => propGenerator.build(propGenerator.input.parse(withDna(propInput, d))),
    version: propGenerator.version,
  },
  {
    name: "sheet-generator-character",
    consumer: "sheet_generator",
    build: (d) =>
      sheetGeneratorCharacter.build(
        sheetGeneratorCharacter.input.parse(withDna(characterSheetInput, d)),
      ),
    version: sheetGeneratorCharacter.version,
  },
  {
    name: "sheet-generator-location",
    consumer: "sheet_generator",
    build: (d) =>
      sheetGeneratorLocation.build(
        sheetGeneratorLocation.input.parse(withDna(locationSheetInput, d)),
      ),
    version: sheetGeneratorLocation.version,
  },
  {
    name: "sheet-generator-prop",
    consumer: "sheet_generator",
    build: (d) =>
      sheetGeneratorProp.build(sheetGeneratorProp.input.parse(withDna(propSheetInput, d))),
    version: sheetGeneratorProp.version,
  },
];

describe.each(CASES)("$name takes its Creative Bible slice", (c) => {
  const block = renderCreativeDna(c.consumer, bible).text;
  const without = c.build();
  const withBible = c.build(block);

  it("appends the bible as the last cached system block, after its own instructions", () => {
    const last = withBible.system.at(-1);
    expect(last?.cache).toBe(true);
    expect(partText(last)).toBe(block);
    expect(partText(last)).toContain("<creative_dna ");
    expect(partText(last)).toContain("<self_check_before_output>");
  });

  it("leaves the user message alone", () => {
    expect(withBible.messages).toEqual(without.messages);
  });

  it("is byte-identical to the prompt without a bible when none is given", () => {
    expect(c.build(undefined)).toEqual(without);
    expect(without.system.some((p) => partText(p).includes("<creative_dna"))).toBe(false);
  });

  it("keeps the shared prefix of the system prompt unchanged (cache hits stay valid)", () => {
    if (c.consumer === "script_checker") return; // replaces the modules, see its own test
    expect(withBible.system.slice(0, -1)).toEqual(without.system);
  });

  it("stays within the four cache breakpoints", () => {
    expect(countBreakpoints(withBible)).toBeLessThanOrEqual(4);
    expect(countBreakpoints(withBible)).toBeGreaterThan(countBreakpoints(without) - 1);
  });
});

describe("the slice follows the consumer", () => {
  it("each consumer's block differs and carries its own QC stage", () => {
    const writer = renderCreativeDna("script_writer", bible).text;
    const checker = renderCreativeDna("script_checker", bible).text;
    const assets = renderCreativeDna("asset_generation", bible).text;
    const sheets = renderCreativeDna("sheet_generator", bible).text;
    expect(new Set([writer, checker, assets, sheets]).size).toBe(4);
  });

  it("every changed dami's version moved past the pre-bible one", () => {
    expect(Object.fromEntries(CASES.map((c) => [c.name, c.version]))).toMatchObject({
      "script-writer (generate)": "0.3.0",
      "script-writer-outline": "0.3.0",
      "script-checker": "1.1.0",
      "character-generator": "5.1.0",
      "location-generator": "1.1.0",
      "prop-generator": "1.1.0",
      "sheet-generator-character": "4.1.0",
      "sheet-generator-location": "1.1.0",
      "sheet-generator-prop": "1.1.0",
    });
  });
});

describe("script-checker with a bible", () => {
  const block = renderCreativeDna("script_checker", bible).text;

  it("uses the script_checker slice instead of the generic modules", () => {
    const parsed = scriptChecker.input.parse(withDna(checkerInput, block));
    const withBible = scriptChecker.build(parsed);
    const without = scriptChecker.build(scriptChecker.input.parse(checkerInput));
    expect(without.system.length).toBeGreaterThan(1);
    expect(withBible.system).toHaveLength(2);
    expect(withBible.system[0]).toEqual(without.system[0]);
    expect(partText(withBible.system[1])).toBe(block);
    expect(countBreakpoints(withBible)).toBe(2);
  });
});
