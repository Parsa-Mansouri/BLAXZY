import { describe, expect, it } from "vitest";
import {
  AUTO_VALUE,
  buildFixRequests,
  findReviewOption,
  freeTextCode,
  freeTextFixRequest,
  getReviewCatalog,
  noteOutsideRequests,
  REVIEW_CATALOG_KEYS,
  REVIEW_OPTION_KINDS,
  ReviewCatalogError,
  visibleOptions,
} from "./review-catalog";

describe("review catalogs", () => {
  it.each(REVIEW_CATALOG_KEYS)("%s loads and normalizes", (key) => {
    const catalog = getReviewCatalog(key);
    expect(catalog.key).toBe(key);
    expect(catalog.options.length).toBeGreaterThan(0);
    for (const option of catalog.options) {
      expect(option.code).toMatch(/^[A-Z]+\d+$/);
      expect(REVIEW_OPTION_KINDS).toContain(option.kind);
      expect(option.label.trim().length).toBeGreaterThan(0);
      // English labels: no Arabic-script letters.
      expect(option.label).not.toMatch(/[؀-ۿ]/);
      for (const choice of option.followup?.options ?? []) {
        expect(choice.label).not.toMatch(/[؀-ۿ]/);
      }
      if ((option.kind === "technical" || option.kind === "preference") && option.callsClaude) {
        expect(option.instruction ?? option.instructionTemplate).toBeTruthy();
      }
      if (option.group) expect(catalog.groups.map((g) => g.id)).toContain(option.group);
    }
    for (const group of catalog.groups) expect(group.label).not.toMatch(/[؀-ۿ]/);
    if (catalog.attemptMessage) expect(catalog.attemptMessage.en).not.toMatch(/[؀-ۿ]/);
  });

  it("keeps the Farsi next to the English labels", () => {
    const character = getReviewCatalog("character-generator");
    const p01 = findReviewOption(character, "P01");
    expect(p01).toMatchObject({
      kind: "preference",
      label: "Age or facial look",
      conflictsWithReference: "face",
      needsText: false,
    });
    expect(p01?.labelFa).toBeTruthy();
    expect(p01?.followup?.options[0]).toMatchObject({ label: "Older", value: "noticeably older" });
    expect(findReviewOption(character, "R01")).toMatchObject({
      kind: "regenerate",
      callsClaude: false,
    });
    expect(character.maxAttemptsBeforeSuggestion).toBe(4);
    expect(character.attemptMessage?.fa).toBeTruthy();
  });

  it("maps every shape's flags", () => {
    const sheet = getReviewCatalog("sheet-generator-character");
    expect(sheet.groups.map((g) => g.id)).toEqual([
      "face",
      "full_body",
      "layout",
      "background",
      "details",
      "general",
    ]);
    expect(findReviewOption(sheet, "ST02")?.suggestFirst).toBe("SR01");
    expect(findReviewOption(sheet, "ST22")?.hideWhen).toEqual({
      key: "render_cell_numbers",
      value: false,
    });
    expect(findReviewOption(sheet, "SX01")?.kind).toBe("route");
    expect(findReviewOption(sheet, "SP01")?.followup?.steps?.[0]).toMatchObject({
      type: "select_detail_cell",
      label: "Which frame? (the number on the image)",
    });

    const detector = getReviewCatalog("asset-detector");
    expect(findReviewOption(detector, "ADT02")).toMatchObject({
      targetCount: 2,
      callsClaude: true,
    });
    expect(findReviewOption(detector, "ADP01")).toMatchObject({ callsClaude: false });
    expect(findReviewOption(detector, "ADT07")?.proOnly).toBe(true);
    expect(findReviewOption(detector, "ADR01")?.kind).toBe("regenerate");
    expect(findReviewOption(detector, "BO04")).toMatchObject({ kind: "backend", proOnly: true });
    expect(findReviewOption(detector, "ADT04")?.followup?.options.map((o) => o.value)).toEqual([
      "character",
      "location",
      "prop",
    ]);

    const prop = getReviewCatalog("prop-generator");
    expect(prop.groups.find((g) => g.id === "studio")?.label).toBe("Studio");
    expect(findReviewOption(prop, "AR01")).toMatchObject({
      kind: "regenerate",
      action: "regenerate_new_seed",
    });
    const locationSheet = getReviewCatalog("sheet-generator-location");
    expect(findReviewOption(locationSheet, "LST05")?.editEligible).toBe(true);
    expect(findReviewOption(locationSheet, "LSX01")?.kind).toBe("route");
  });

  it("hides Pro-only and conditional options", () => {
    const character = getReviewCatalog("character-generator");
    const wizard = visibleOptions(character, { sector: "wizard" }).map((o) => o.code);
    expect(wizard).not.toContain("P12");
    expect(wizard).not.toContain("T12");
    expect(wizard).not.toContain("T11");
    const pro = visibleOptions(character, {
      sector: "pro",
      context: { face_reference: true, outfit_reference: true },
    }).map((o) => o.code);
    expect(pro).toEqual(expect.arrayContaining(["P12", "T11", "T12"]));

    const sheet = getReviewCatalog("sheet-generator-character");
    expect(visibleOptions(sheet, { sector: "wizard" }).map((o) => o.code)).toContain("ST22");
    expect(
      visibleOptions(sheet, { sector: "wizard", context: { render_cell_numbers: false } }).map(
        (o) => o.code,
      ),
    ).not.toContain("ST22");
    const location = getReviewCatalog("location-generator");
    expect(visibleOptions(location, { sector: "wizard" }).map((o) => o.code)).not.toContain("LP09");
  });

  it("builds fix requests from picks", () => {
    const character = getReviewCatalog("character-generator");
    expect(
      buildFixRequests(character, [
        { code: "T01" },
        { code: "P02", value: "shorter hair" },
        { code: "P05", customText: "warm olive" },
        { code: "R01" },
      ]),
    ).toEqual([
      {
        type: "technical",
        code: "T01",
        instruction: findReviewOption(character, "T01")?.instruction,
      },
      {
        type: "preference",
        code: "P02",
        instruction:
          "Change only the hairstyle or hair color to: shorter hair. Keep face, body and outfit identical.",
      },
      {
        type: "preference",
        code: "P05",
        instruction: "Change only the skin tone to: warm olive. Keep everything else identical.",
        customText: "warm olive",
      },
    ]);

    const sheet = getReviewCatalog("sheet-generator-character");
    const [frame, auto] = buildFixRequests(sheet, [
      {
        code: "SP01",
        value: "the belt and its buckle",
        slot: { slot: 4, subject: "leather boots, side view" },
        viewId: "sheet",
      },
      { code: "SP01", value: AUTO_VALUE, slot: { slot: 2, subject: "boots" } },
    ]);
    expect(frame).toEqual({
      type: "preference",
      code: "SP01",
      instruction:
        "Replace detail frame 4 (leather boots, side view) with: the belt and its buckle. It must match the approved design exactly. All other frames keep their subjects and their numbers.",
      viewId: "sheet",
    });
    expect(auto?.instruction).toBe(
      "Replace detail frame 2 (boots) with the next most distinctive element of the character that is not yet shown. All other frames keep their subjects and their numbers.",
    );

    const detector = getReviewCatalog("asset-detector");
    expect(
      buildFixRequests(detector, [
        { code: "ADT04", value: "prop", targetNames: ["Ferry"] },
        { code: "ADP01", targetNames: ["Ferry"] },
      ]),
    ).toEqual([
      {
        type: "technical",
        code: "ADT04",
        instruction: findReviewOption(detector, "ADT04")?.instruction,
        customText: "prop",
        targetNames: ["Ferry"],
      },
    ]);
  });

  it("rejects picks that do not fit the catalog", () => {
    const character = getReviewCatalog("character-generator");
    expect(() => buildFixRequests(character, [{ code: "ZZ01" }])).toThrow(ReviewCatalogError);
    expect(() => buildFixRequests(character, [{ code: "P99" }])).toThrow(/\{value\}/);
    const sheet = getReviewCatalog("sheet-generator-character");
    expect(() => buildFixRequests(sheet, [{ code: "SP01", value: "x" }])).toThrow(/\{slot\}/);
    const location = getReviewCatalog("location-generator");
    expect(() => buildFixRequests(location, [{ code: "LP03" }])).toThrow(/text/);
  });
});

describe("free-text change requests", () => {
  it.each(REVIEW_CATALOG_KEYS)("%s has a free-text option that carries the note", (key) => {
    const option = findReviewOption(getReviewCatalog(key), freeTextCode(key));
    expect(option?.kind).toBe("preference");
    expect(option?.callsClaude).toBe(true);
    const request = freeTextFixRequest(key, "  Make the door red.  ");
    expect(request).toMatchObject({
      type: "preference",
      code: freeTextCode(key),
      customText: "Make the door red.",
    });
    // The note is in the instruction too (the templates fill {value}) or in the custom text.
    expect(request.instruction.length).toBeGreaterThan(0);
  });

  it("refuses an empty note", () => {
    expect(() => freeTextFixRequest("asset-detector", "   ")).toThrow(ReviewCatalogError);
  });

  it("keeps the note out of user notes when a request already carries it", () => {
    expect(noteOutsideRequests("Older.", [{ customText: "Older." }])).toBeUndefined();
    expect(noteOutsideRequests("Older.", [])).toBe("Older.");
    expect(noteOutsideRequests("  ", [])).toBeUndefined();
    expect(noteOutsideRequests(null, [{ customText: "x" }])).toBeUndefined();
  });
});
