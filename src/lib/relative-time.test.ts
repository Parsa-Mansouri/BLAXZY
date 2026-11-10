import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./relative-time";

const now = new Date("2026-06-15T12:00:00Z");
const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

describe("formatRelativeTime", () => {
  it("handles the common ranges", () => {
    expect(formatRelativeTime(ago(10), now)).toBe("just now");
    expect(formatRelativeTime(ago(5 * 60), now)).toBe("5 minutes ago");
    expect(formatRelativeTime(ago(3 * 3600), now)).toBe("3 hours ago");
    expect(formatRelativeTime(ago(24 * 3600), now)).toBe("yesterday");
    expect(formatRelativeTime(ago(21 * 24 * 3600), now)).toBe("3 weeks ago");
    expect(formatRelativeTime(ago(400 * 24 * 3600).toISOString(), now)).toBe("last year");
  });

  it("does not show the future as negative nonsense", () => {
    expect(formatRelativeTime(new Date(now.getTime() + 5000), now)).toBe("just now");
  });
});
