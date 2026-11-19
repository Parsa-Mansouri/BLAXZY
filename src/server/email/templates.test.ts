import { describe, expect, it } from "vitest";
import { escapeHtml, renderEmail } from "./layout";
import { existingAccountEmail, passwordResetEmail, verificationCodeEmail } from "./templates";

const LINK = "https://app.example.com/verify?token=abc&x=1";
const HOSTILE_LINK = 'https://app.example.com/v?t="><script>alert(1)</script>&a=<b>';
const hostile = {
  email: "victim@example.com",
  name: "Your account is locked, go to evil.example",
};
const builders = [["password reset", passwordResetEmail, "Choose a new password"]] as const;
const CODE = "482913";

describe("verification code email", () => {
  it("carries the code in both parts, next to the words verification code", () => {
    const mail = verificationCodeEmail({ email: "a@example.com" }, CODE);
    expect(mail.to).toBe("a@example.com");
    expect(mail.subject).toBe("Your BLAXZY verification code");
    expect(mail.subject).not.toContain(CODE);
    expect(mail.text).toContain(`verification code:\n\n${CODE}\n`);
    expect(mail.text).toContain("10 minutes");
    expect(mail.text).not.toMatch(/<\/?[a-z][^>]*>/i);
    expect(mail.actionUrl).toBeUndefined();
    const html = mail.html ?? "";
    expect(html).toMatch(/^<!DOCTYPE html/);
    expect(html).toContain(`>${CODE}</div>`);
    expect(html).toContain("verification code");
    expect(html).toContain("user-select:all");
    expect(html).not.toContain("Copy code");
    expect(html).toContain("10 minutes");
  });

  it("links nowhere: no verify link, and the code is in no URL", () => {
    const mail = verificationCodeEmail({ email: "a@example.com" }, CODE);
    const html = mail.html ?? "";
    expect(html).not.toContain("verify-email");
    expect(html).not.toContain("href=");
    expect(mail.text).not.toContain("http");
  });

  it("never contains the signed-up name", () => {
    const mail = verificationCodeEmail(hostile, CODE);
    expect(mail.to).toBe("victim@example.com");
    for (const part of [mail.text, mail.html ?? "", mail.subject]) {
      expect(part).not.toContain("locked");
      expect(part).not.toContain("evil.example");
    }
    expect(mail.text.startsWith("Hello,\n")).toBe(true);
  });

  it("escapes the code in the HTML part", () => {
    const html = verificationCodeEmail({ email: "a@example.com" }, "<b>1</b>").html ?? "";
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;1&lt;/b&gt;");
  });
});

const SIGN_IN = "https://app.example.com/sign-in";
const RESET = "https://app.example.com/forgot-password?a=1&b=2";

describe("email templates", () => {
  it.each(builders)("%s mail never contains the signed-up name", (_label, build) => {
    const mail = build(hostile, LINK);
    expect(mail.to).toBe("victim@example.com");
    expect(mail.text).not.toContain("locked");
    expect(mail.text).not.toContain("evil.example");
    expect(mail.html).not.toContain("locked");
    expect(mail.html).not.toContain("evil.example");
    expect(mail.subject).not.toContain("evil.example");
    expect(mail.text.startsWith("Hello,\n")).toBe(true);
  });

  it.each(builders)("%s mail is plain text carrying the link and action url", (_label, build) => {
    const mail = build({ email: "a@example.com" }, LINK);
    expect(mail.text).toContain(LINK);
    expect(mail.actionUrl).toBe(LINK);
    expect(mail.text).not.toMatch(/<\/?[a-z][^>]*>/i);
  });

  it.each(builders)("%s mail has an HTML part with the button", (_label, build, button) => {
    const html = build({ email: "a@example.com" }, LINK).html ?? "";
    expect(html).toContain(`href="${escapeHtml(LINK)}"`);
    expect(html).toContain(button);
    expect(html).toMatch(/^<!DOCTYPE html/);
  });

  it.each(builders)("%s mail escapes a hostile link in the HTML part", (_label, build) => {
    const html = build({ email: "a@example.com" }, HOSTILE_LINK).html ?? "";
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('?t="');
    expect(html).not.toContain("<b>");
    expect(html).toContain(escapeHtml(HOSTILE_LINK));
    expect(escapeHtml(HOSTILE_LINK)).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("existing-account mail links sign-in and reset, without the name", () => {
    const mail = existingAccountEmail(hostile, { signInUrl: SIGN_IN, resetPasswordUrl: RESET });
    expect(mail.text).toContain(SIGN_IN);
    expect(mail.text).toContain(RESET);
    expect(mail.text).not.toMatch(/<\/?[a-z][^>]*>/i);
    expect(mail.actionUrl).toBeUndefined();
    const html = mail.html ?? "";
    expect(html).toContain(`href="${SIGN_IN}"`);
    expect(html).toContain(`href="${escapeHtml(RESET)}"`);
    expect(html).toContain("Sign in");
    expect(html).toContain("Choose a new one");
    expect(html).not.toContain("locked");
    expect(html).not.toContain("evil.example");
  });

  it("existing-account mail escapes hostile links", () => {
    const html =
      existingAccountEmail(
        { email: "a@example.com" },
        { signInUrl: HOSTILE_LINK, resetPasswordUrl: HOSTILE_LINK },
      ).html ?? "";
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
  });
});

describe("renderEmail", () => {
  it("escapes every interpolated value", () => {
    const evil = `<i>"x"&'y'</i>`;
    const html = renderEmail({
      preheader: evil,
      heading: evil,
      paragraphs: [evil],
      action: { label: evil, url: evil },
      secondary: { lead: evil, label: evil, url: evil },
      footnote: evil,
    });
    expect(html).not.toContain("<i>");
    expect(html).not.toContain('"x"');
    expect(html).toContain("&lt;i&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/i&gt;");
  });

  it("escapes every interpolated value of a code mail", () => {
    const evil = `<i>"x"&'y'</i>`;
    const html = renderEmail({
      preheader: evil,
      heading: evil,
      paragraphs: [evil],
      code: evil,
      footnote: evil,
    });
    expect(html).not.toContain("<i>");
    expect(html).not.toContain('"x"');
    expect(html).not.toContain("Paste this link");
  });
});
