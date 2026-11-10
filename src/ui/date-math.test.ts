import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  buildMonthGrid,
  clampISO,
  daysInMonth,
  endOfWeek,
  formatDate,
  isOutOfRange,
  parseISO,
  startOfWeek,
  todayISO,
  weekdayLabels,
  weekdayOf,
} from "./date-math";

describe("calendar maths", () => {
  it("parses strict ISO dates only", () => {
    expect(parseISO("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseISO("2025-02-29")).toBeNull();
    expect(parseISO("2025-13-01")).toBeNull();
    expect(parseISO("2025-1-1")).toBeNull();
    expect(parseISO("")).toBeNull();
    expect(parseISO(null)).toBeNull();
  });

  it("knows month lengths including leap years", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2025, 12)).toBe(31);
    expect(daysInMonth(2025, 4)).toBe(30);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2025-01-31", 1)).toBe("2025-02-01");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2025-03-01", -1)).toBe("2025-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
  });

  it("adds months and clamps the day", () => {
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2025-12-15", 1)).toBe("2026-01-15");
    expect(addMonths("2025-01-15", -1)).toBe("2024-12-15");
    expect(addMonths("2025-01-15", -13)).toBe("2023-12-15");
    expect(addMonths("2025-05-15", 12)).toBe("2026-05-15");
  });

  it("computes weekdays and week bounds", () => {
    expect(weekdayOf("2023-01-01")).toBe(0);
    expect(weekdayOf("2025-06-18")).toBe(3);
    expect(startOfWeek("2025-06-18", 1)).toBe("2025-06-16");
    expect(endOfWeek("2025-06-18", 1)).toBe("2025-06-22");
    expect(startOfWeek("2025-06-18", 0)).toBe("2025-06-15");
    expect(startOfWeek("2025-06-16", 1)).toBe("2025-06-16");
  });

  it("clamps and detects out-of-range dates", () => {
    expect(clampISO("2025-01-01", "2025-02-01", "2025-03-01")).toBe("2025-02-01");
    expect(clampISO("2025-04-01", "2025-02-01", "2025-03-01")).toBe("2025-03-01");
    expect(clampISO("2025-02-10", "2025-02-01", "2025-03-01")).toBe("2025-02-10");
    expect(isOutOfRange("2025-02-10", "2025-02-11")).toBe(true);
    expect(isOutOfRange("2025-02-10", undefined, "2025-02-10")).toBe(false);
  });

  it("builds a stable 6x7 grid starting on the chosen weekday", () => {
    const grid = buildMonthGrid(2025, 6, 1);
    expect(grid).toHaveLength(6);
    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(grid[0]![0]!.iso).toBe("2025-05-26");
    expect(grid[0]![6]!.iso).toBe("2025-06-01");
    expect(grid.flat().filter((d) => d.inMonth)).toHaveLength(30);
    const sunday = buildMonthGrid(2025, 6, 0);
    expect(sunday[0]![0]!.iso).toBe("2025-06-01");
    expect(sunday[0]![0]!.inMonth).toBe(true);
  });

  it("formats today from a local date", () => {
    expect(todayISO(new Date(2025, 0, 5, 23, 59))).toBe("2025-01-05");
  });

  it("formats dates and weekday labels independent of time zone", () => {
    expect(formatDate("2025-06-18", "en-US")).toBe("June 18, 2025");
    expect(weekdayLabels(1, "en-US")[0]).toBe("Mon");
    expect(weekdayLabels(0, "en-US")[0]).toBe("Sun");
  });
});
