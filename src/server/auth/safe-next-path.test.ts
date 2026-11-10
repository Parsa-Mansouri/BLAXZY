import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/server/auth/safe-next-path";

describe("safeNextPath", () => {
  it.each([
    ["/", "/"],
    ["/dashboard", "/dashboard"],
    ["/projects/abc?tab=script#c1", "/projects/abc?tab=script#c1"],
    ["/a/../b", "/b"],
    ["/search?q=http://evil.com", "/search?q=http://evil.com"],
    ["/%2F%2Fevil.com", "/%2F%2Fevil.com"],
  ])("allows %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    "",
    "dashboard",
    "https://evil.com",
    "http://localhost:3000/dashboard",
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "/\\/evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    " /dashboard",
    "/dash board",
    "javascript:alert(1)",
    "/.//evil.com",
    "/" + "a".repeat(3000),
  ])("rejects %j", (input) => {
    expect(safeNextPath(input)).toBe("/");
  });

  it("rejects non-strings", () => {
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(["/dashboard"])).toBe("/");
    expect(safeNextPath(42)).toBe("/");
  });

  it("uses the given fallback", () => {
    expect(safeNextPath("https://evil.com", "/dashboard")).toBe("/dashboard");
  });
});
