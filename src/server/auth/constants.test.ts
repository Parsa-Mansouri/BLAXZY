import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/server/auth/constants";

describe("isPublicPath", () => {
  it.each([
    "/",
    "/login",
    "/login/",
    "/signup",
    "/verify-email",
    "/forgot-password",
    "/reset-password",
    "/api/auth",
    "/api/auth/sign-in/email",
    "/api/health",
    "/api/health/live",
  ])("treats %j as public", (path) => {
    expect(isPublicPath(path, false)).toBe(true);
  });

  it.each([
    "/dashboard",
    "/projects/1",
    "/loginx",
    "/api/projects",
    "/api/authx",
    "/api/health/x",
    "/dev/ui",
  ])("treats %j as protected", (path) => {
    expect(isPublicPath(path, false)).toBe(false);
  });

  it("opens /dev only in development", () => {
    expect(isPublicPath("/dev", true)).toBe(true);
    expect(isPublicPath("/dev/ui", true)).toBe(true);
    expect(isPublicPath("/devices", true)).toBe(false);
  });
});
