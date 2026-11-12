import { describe, expect, it } from "vitest";
import { containsQuote, normalizeQuoteText } from "./quotes";

describe("normalizeQuoteText", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeQuoteText("  a\r\n\tb   c \n")).toBe("a b c");
  });

  it("maps Arabic yeh, alef maksura and kaf to their Persian forms", () => {
    expect(normalizeQuoteText("علي")).toBe("علی");
    expect(normalizeQuoteText("موسى")).toBe("موسی");
    expect(normalizeQuoteText("كتاب")).toBe("کتاب");
  });

  it("removes the zero-width non-joiner", () => {
    expect(normalizeQuoteText("نامه‌ای")).toBe("نامهای");
  });
});

describe("containsQuote", () => {
  it("matches across line breaks and CRLF", () => {
    expect(containsQuote("She opens\r\nher hand.", "opens her hand")).toBe(true);
  });

  it("treats an empty quote as found", () => {
    expect(containsQuote("anything", "  ")).toBe(true);
  });

  it("does not match text that is absent", () => {
    expect(containsQuote("She opens her hand.", "He opens")).toBe(false);
  });

  it("matches Persian text typed with Arabic letters or without the non-joiner", () => {
    const script = "مریم پشت میز نشسته است و نامه‌ای را می‌خواند.";
    expect(containsQuote(script, "مريم پشت ميز")).toBe(true);
    expect(containsQuote(script, "نامهای را میخواند")).toBe(true);
    expect(containsQuote("یک کتاب", "يك كتاب")).toBe(true);
  });
});
