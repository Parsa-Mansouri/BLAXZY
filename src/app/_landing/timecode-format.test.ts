import { describe, expect, it } from "vitest";
import { formatTimecode } from "./timecode-format";

describe("formatTimecode", () => {
  it("counts frames at 24 fps", () => {
    expect(formatTimecode(0)).toBe("00:00:00:00");
    expect(formatTimecode(23)).toBe("00:00:00:23");
    expect(formatTimecode(24)).toBe("00:00:01:00");
  });

  it("rolls seconds into minutes and hours", () => {
    expect(formatTimecode(15 * 24 * 4)).toBe("00:01:00:00");
    expect(formatTimecode(3600 * 24 + 5)).toBe("01:00:00:05");
  });
});
