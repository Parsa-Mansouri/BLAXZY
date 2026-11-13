import { describe, expect, it } from "vitest";
import { checkLocationSheet } from "./sheet-generator-location/dami";
import locationInput from "./sheet-generator-location/fixtures/input.json";
import locationOutput from "./sheet-generator-location/fixtures/model-output.json";
import {
  locationSheetInputSchema,
  locationSheetOutputSchema,
} from "./sheet-generator-location/schema";
import { checkPropSheet } from "./sheet-generator-prop/dami";
import propInput from "./sheet-generator-prop/fixtures/input.json";
import propOutput from "./sheet-generator-prop/fixtures/model-output.json";
import { propSheetInputSchema, propSheetOutputSchema } from "./sheet-generator-prop/schema";
import { duplicateIds, MAX_SHEET_VIEWS, record } from "./shared/designer";

describe("sheet maker views", () => {
  it("accepts the fixtures", () => {
    expect(locationSheetOutputSchema.safeParse(locationOutput).success).toBe(true);
    expect(propSheetOutputSchema.safeParse(propOutput).success).toBe(true);
  });

  it("rejects more than 20 views in both schemas", () => {
    const loc = locationSheetOutputSchema.parse(locationOutput);
    const prop = propSheetOutputSchema.parse(propOutput);
    const manyLoc = {
      ...loc,
      views: Array.from({ length: MAX_SHEET_VIEWS + 1 }, () => loc.views[0]),
    };
    const manyProp = {
      ...prop,
      views: Array.from({ length: MAX_SHEET_VIEWS + 1 }, () => prop.views[0]),
    };
    expect(locationSheetOutputSchema.safeParse(manyLoc).success).toBe(false);
    expect(propSheetOutputSchema.safeParse(manyProp).success).toBe(false);
  });

  it("names duplicate view ids so the corrective retry can fix them", () => {
    const loc = locationSheetOutputSchema.parse(locationOutput);
    const lin = locationSheetInputSchema.parse(locationInput);
    const first = loc.views[0]!;
    const dup = { ...loc, views: [...loc.views, { ...first }] };
    expect(checkLocationSheet(dup, lin).join("\n")).toContain(
      `every view_id must appear once in views: ${first.view_id} appear more than once`,
    );

    const prop = propSheetOutputSchema.parse(propOutput);
    const pin = propSheetInputSchema.parse(propInput);
    const pfirst = prop.views[0]!;
    const pdup = { ...prop, views: [...prop.views, { ...pfirst }] };
    expect(checkPropSheet(pdup, pin).join("\n")).toContain(
      `every view_id must appear once in views: ${pfirst.view_id} appear more than once`,
    );
  });
});

describe("shared designer helpers", () => {
  it("duplicateIds lists each repeated id once", () => {
    expect(duplicateIds(["a", "b", "a", "a", "c", "b"])).toEqual(["a", "b"]);
    expect(duplicateIds(["a", "b"])).toEqual([]);
  });

  it("record accepts plain objects only", () => {
    expect(record({ a: 1 })).toEqual({ a: 1 });
    expect(record([1])).toBeNull();
    expect(record(null)).toBeNull();
    expect(record("x")).toBeNull();
  });
});
