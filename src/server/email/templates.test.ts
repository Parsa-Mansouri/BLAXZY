import { describe, expect, it } from "vitest";
import { passwordResetEmail, verificationEmail } from "./templates";

const LINK = "https://app.example.com/verify?token=abc";
const hostile = {
  email: "victim@example.com",
  name: "Your account is locked, go to evil.example",
};
const builders = [
  ["verification", verificationEmail],
  ["password reset", passwordResetEmail],
] as const;

describe("email templates", () => {
  it.each(builders)("%s mail never contains the signed-up name", (_label, build) => {
    const mail = build(hostile, LINK);
    expect(mail.to).toBe("victim@example.com");
    expect(mail.text).not.toContain("locked");
    expect(mail.text).not.toContain("evil.example");
    expect(mail.subject).not.toContain("evil.example");
    expect(mail.text.startsWith("Hello,\n")).toBe(true);
  });

  it.each(builders)("%s mail is plain text carrying the link and action url", (_label, build) => {
    const mail = build({ email: "a@example.com" }, LINK);
    expect(mail.text).toContain(LINK);
    expect(mail.actionUrl).toBe(LINK);
    expect(mail.text).not.toMatch(/<\/?[a-z][^>]*>/i);
  });
});
