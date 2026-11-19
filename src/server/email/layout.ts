/**
 * The HTML shell of every BLAXZY mail: the dark "film credits" look of the brand, built for mail
 * clients (table layout, inline styles, no images, a VML button for Outlook). Every interpolated
 * value goes through `escapeHtml`, URLs included, so nothing passed in can add markup.
 */

export type EmailLayout = {
  /** Hidden preview line shown next to the subject in most inboxes. */
  preheader: string;
  heading: string;
  paragraphs: string[];
  action: { label: string; url: string };
  /** A smaller second way out under the button, e.g. "Forgot your password? Choose a new one". */
  secondary?: { lead: string; label: string; url: string };
  /** Small print under the card (expiry, "if this was not you"). */
  footnote: string;
};

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const PAGE = "#000000";
const CARD = "#0a0a0b";
const BORDER = "#1f1f21";
const INK = "#f2f2f3";
const BODY = "#c9c9ce";
const MUTED = "#a1a1a6";
const FAINT = "#6e6e73";

function button(label: string, url: string): string {
  const href = escapeHtml(url);
  const text = escapeHtml(label);
  // Outlook ignores padding on <a> and border-radius, so it gets a VML pill of a fixed width.
  const vmlWidth = Math.max(220, label.length * 11 + 72);
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin:0;">
<tr>
<td align="left">
<!--[if mso]>
<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:${vmlWidth}px;" arcsize="50%" stroke="f" fillcolor="#ffffff">
<w:anchorlock/>
<center style="color:#000000;font-family:Helvetica, Arial, sans-serif;font-size:13px;font-weight:bold;letter-spacing:2px;">${text}</center>
</v:roundrect>
<![endif]-->
<!--[if !mso]><!-- -->
<table role="presentation" border="0" cellpadding="0" cellspacing="0">
<tr>
<td bgcolor="#ffffff" style="background-color:#ffffff;border-radius:999px;mso-padding-alt:0;">
<a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:15px 34px;font-family:${FONT};font-size:13px;line-height:18px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#000000;text-decoration:none;border-radius:999px;">${text}</a>
</td>
</tr>
</table>
<!--<![endif]-->
</td>
</tr>
</table>`;
}

export function renderEmail(layout: EmailLayout): string {
  const { preheader, heading, paragraphs, action, secondary, footnote } = layout;
  const url = escapeHtml(action.url);

  const body = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;line-height:1.6;color:${BODY};">${escapeHtml(p)}</p>`,
    )
    .join("\n");

  const secondaryBlock = secondary
    ? `<tr>
<td style="padding:28px 0 0 0;border-top:1px solid ${BORDER};">
<p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${MUTED};">${escapeHtml(secondary.lead)} <a href="${escapeHtml(secondary.url)}" target="_blank" rel="noopener" style="color:${INK};text-decoration:underline;text-underline-offset:3px;">${escapeHtml(secondary.label)}</a></p>
</td>
</tr>`
    : "";

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no" />
<title>${escapeHtml(heading)}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<style type="text/css">
:root { color-scheme: dark; supported-color-schemes: dark; }
body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: ${PAGE}; }
table { border-collapse: collapse; }
a { color: ${INK}; }
@media only screen and (max-width: 600px) {
  .bx-outer { padding: 24px 12px !important; }
  .bx-card { padding: 36px 24px 32px 24px !important; }
  .bx-heading { font-size: 23px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${PAGE};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${PAGE};">${escapeHtml(preheader)}${"&#8199;&#847; ".repeat(40)}</div>
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${PAGE}" style="background-color:${PAGE};">
<tr>
<td align="center" class="bx-outer" style="padding:48px 16px;">
<!--[if mso]><table role="presentation" width="560" border="0" cellpadding="0" cellspacing="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;">
<tr>
<td class="bx-card" bgcolor="${CARD}" style="background-color:${CARD};border:1px solid ${BORDER};border-radius:16px;padding:44px 44px 40px 44px;">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0">
<tr>
<td style="padding:0 0 28px 0;font-family:${FONT};font-size:13px;line-height:16px;font-weight:800;letter-spacing:0.35em;text-transform:uppercase;color:${INK};">BLAXZY</td>
</tr>
<tr>
<td style="padding:0;font-size:0;line-height:0;height:1px;background-color:${BORDER};">&nbsp;</td>
</tr>
<tr>
<td style="padding:36px 0 0 0;">
<h1 class="bx-heading" style="margin:0 0 20px 0;font-family:${FONT};font-size:26px;line-height:1.25;font-weight:600;letter-spacing:-0.01em;color:${INK};">${escapeHtml(heading)}</h1>
${body}
</td>
</tr>
<tr>
<td style="padding:16px 0 0 0;">
${button(action.label, action.url)}
</td>
</tr>
<tr>
<td style="padding:24px 0 ${secondary ? "28px" : "0"} 0;">
<p style="margin:0 0 6px 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};">Button not working? Paste this link into your browser:</p>
<p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};word-break:break-all;"><a href="${url}" target="_blank" rel="noopener" style="color:${MUTED};text-decoration:underline;word-break:break-all;">${url}</a></p>
</td>
</tr>
${secondaryBlock}
</table>
</td>
</tr>
<tr>
<td align="center" style="padding:32px 24px 0 24px;">
<p style="margin:0 0 12px 0;font-family:${FONT};font-size:11px;line-height:16px;font-weight:600;letter-spacing:0.3em;text-transform:uppercase;color:${FAINT};">BLAXZY &middot; AI Film Studio</p>
<p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${FAINT};">${escapeHtml(footnote)}</p>
</td>
</tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td>
</tr>
</table>
</body>
</html>`;
}
