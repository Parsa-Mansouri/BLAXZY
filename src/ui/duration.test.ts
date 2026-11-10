import { describe, expect, it } from "vitest";
import {
  clampDuration,
  formatDuration,
  formatDurationLong,
  joinDuration,
  parseDuration,
  splitDuration,
} from "./duration";

describe("duration", () => {
  it("splits and joins", () => {
    expect(splitDuration(90)).toEqual({ minutes: 1, seconds: 30 });
    expect(splitDuration(0)).toEqual({ minutes: 0, seconds: 0 });
    expect(splitDuration(-5)).toEqual({ minutes: 0, seconds: 0 });
    expect(joinDuration(2, 75)).toBe(195);
    expect(joinDuration(-1, 10)).toBe(10);
  });

  it("formats", () => {
    expect(formatDuration(90)).toBe("1:30");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(3725)).toBe("62:05");
    expect(formatDurationLong(90)).toBe("1 min 30 s");
    expect(formatDurationLong(60)).toBe("1 min");
    expect(formatDurationLong(45)).toBe("45 s");
  });

  it("parses what people type", () => {
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("1m 30s")).toBe(90);
    expect(parseDuration("2 min")).toBe(120);
    expect(parseDuration("45s")).toBe(45);
    expect(parseDuration("1h 5m")).toBe(3900);
    expect(parseDuration("  0:05 ")).toBe(5);
  });

  it("rejects nonsense", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("1:75")).toBeNull();
    expect(parseDuration("1:2:3")).toBeNull();
  });

  it("clamps", () => {
    expect(clampDuration(5, 10, 100)).toBe(10);
    expect(clampDuration(500, 10, 100)).toBe(100);
    expect(clampDuration(50)).toBe(50);
  });
});
