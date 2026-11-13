import { describe, expect, it } from "vitest";
import {
  decodeOrderCursor,
  decodeTimestampCursor,
  encodeCursor,
  encodeOrderCursor,
  encodeTimestampCursor,
  isTimestampText,
} from "./cursor";
import { episodeCount, episodeCountOf } from "./episodes";

const ID = "6f1c2a4e-1b2c-4d3e-8f9a-0b1c2d3e4f5a";
const raw = (text: string) => Buffer.from(text, "utf8").toString("base64url");

describe("page cursors", () => {
  it("round-trips an order cursor", () => {
    expect(decodeOrderCursor(encodeOrderCursor(12, ID))).toEqual({ orderIndex: 12, id: ID });
    expect(decodeOrderCursor(encodeOrderCursor(2_147_483_647, ID))?.orderIndex).toBe(2_147_483_647);
  });

  it("keeps the wire format of the assets list's own cursors (`order|id`)", () => {
    // What `listAssets` wrote before it used these helpers: links already handed out still work.
    const legacy = (order: number, id: string) =>
      Buffer.from(`${order}|${id}`, "utf8").toString("base64url");
    for (const order of [0, 1, 37, 2_147_483_647]) {
      expect(encodeOrderCursor(order, ID)).toBe(legacy(order, ID));
      expect(decodeOrderCursor(legacy(order, ID))).toEqual({ orderIndex: order, id: ID });
    }
  });

  it("rejects order cursors the database would choke on", () => {
    for (const order of ["1e300", "2147483648", "-1", "1.5", " 1", "0x10", "", "NaN"]) {
      expect(decodeOrderCursor(raw(`${order}|${ID}`))).toBeNull();
    }
    expect(decodeOrderCursor(raw(`1|not-a-uuid`))).toBeNull();
    expect(decodeOrderCursor(raw(`1|${ID}|x`))).toBeNull();
    expect(decodeOrderCursor("not base64url!")).toBeNull();
    expect(decodeOrderCursor("")).toBeNull();
  });

  it("round-trips a timestamp cursor and refuses impossible dates", () => {
    const ts = "2026-11-13T10:20:30.123456Z";
    expect(decodeTimestampCursor(encodeTimestampCursor(ts, ID))).toEqual({ timestamp: ts, id: ID });
    expect(decodeTimestampCursor(encodeCursor("2026-02-30T10:20:30.123456Z", ID))).toBeNull();
    expect(isTimestampText("2028-02-29T00:00:00.000000Z")).toBe(true);
    expect(isTimestampText("2026-02-29T00:00:00.000000Z")).toBe(false);
    expect(isTimestampText("2026-13-01T00:00:00.000000Z")).toBe(false);
    expect(isTimestampText("2026-01-01T24:00:00.000000Z")).toBe(false);
    expect(isTimestampText("2026-01-01T00:60:00.000000Z")).toBe(false);
    expect(isTimestampText("2026-01-01T00:00:00Z")).toBe(false);
  });
});

describe("episodeCount", () => {
  it("covers the whole runtime (rounds up, as docs/M1_CONTRACTS.md says)", () => {
    expect(episodeCount(100, 30)).toBe(4);
    expect(episodeCount(90, 30)).toBe(3);
    expect(episodeCount(20, 30)).toBe(1);
    expect(episodeCountOf({ format: "movie", totalDurationSeconds: 100 })).toBe(1);
    expect(
      episodeCountOf({ format: "series", totalDurationSeconds: 100, episodeDurationSeconds: 30 }),
    ).toBe(4);
  });
});
