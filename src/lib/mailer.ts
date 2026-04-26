/**
 * Shared Resend mailer. Reads:
 *   RESEND_API_KEY        required
 *   RESEND_FROM           required (e.g. hello@booking.momentella.com)
 *   RESEND_FROM_NAME      optional display name (default "Momentella")
 *   RESEND_REPLY_TO       optional reply-to address
 *   RESEND_TEAM_EMAILS    comma-separated list for team alerts
 *
 * Plus app-wide:
 *   CLIENT_APP_ORIGIN     used to build absolute portal URLs
 */

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /** Optional override of From — defaults to RESEND_FROM + RESEND_FROM_NAME. */
  from?: string;
}

export function isMailerConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

export function teamAlertEmails(): string[] {
  return (process.env.RESEND_TEAM_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function appOrigin(): string {
  return (
    process.env.CLIENT_APP_ORIGIN?.replace(/\/$/, "") ??
    process.env.BETTER_AUTH_URL?.replace(/\/$/, "") ??
    ""
  );
}

function defaultFrom(): string {
  const addr = process.env.RESEND_FROM?.trim();
  if (!addr) return "Momentella <onboarding@resend.dev>";
  const name = process.env.RESEND_FROM_NAME?.trim() || "Momentella";
  return `${name} <${addr}>`;
}

/**
 * Send an email via Resend. Resolves on success, rejects on send failure.
 * Callers should wrap with `void sendEmail(...).catch(log)` for fire-and-forget.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  if (!isMailerConfigured()) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[mailer] RESEND_API_KEY / RESEND_FROM not set — skipping email send",
      );
    }
    return;
  }
  const apiKey = process.env.RESEND_API_KEY!;
  const replyTo = opts.replyTo ?? process.env.RESEND_REPLY_TO?.trim();

  const body: Record<string, unknown> = {
    from: opts.from ?? defaultFrom(),
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
    html: opts.html,
  };
  if (opts.text) body.text = opts.text;
  if (replyTo) body.reply_to = replyTo;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend error (${res.status}): ${text}`);
  }
}

// ── Branded template ──────────────────────────────────────────────────────
//
// Email clients are picky — we use inline styles and a single-column
// 600px-wide table layout. Colors mirror the public site:
//   canvas #f7f4ef · ink #1c1917 · ink-muted #57534e · gold #b8956c

const CANVAS = "#f7f4ef";
const CARD = "#ffffff";
const INK = "#1c1917";
const INK_MUTED = "#57534e";
const LINE = "rgba(28, 25, 23, 0.12)";
const GOLD = "#b8956c";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface BrandedEmailOptions {
  preheader?: string;
  eyebrow?: string;
  heading: string;
  intro?: string;
  /** Already-escaped HTML for the body section. */
  bodyHtml?: string;
  cta?: { label: string; href: string };
  footerNote?: string;
}

export function brandedEmailHtml(opts: BrandedEmailOptions): string {
  const preheader = opts.preheader ? escapeHtml(opts.preheader) : "";
  const eyebrow = opts.eyebrow ? escapeHtml(opts.eyebrow) : "";
  const heading = escapeHtml(opts.heading);
  const intro = opts.intro ? escapeHtml(opts.intro) : "";
  const cta = opts.cta;
  const footer = opts.footerNote ? escapeHtml(opts.footerNote) : "";
  const yearLine = `&copy; ${new Date().getFullYear()} Momentella`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${heading}</title>
</head>
<body style="margin:0;padding:0;background-color:${CANVAS};color:${INK};font-family:Georgia,'Times New Roman',serif;">
${preheader ? `<div style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all;">${preheader}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${CANVAS};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:${CARD};border:1px solid ${LINE};border-radius:16px;overflow:hidden;">
    <tr><td align="center" style="padding:28px 24px 8px;">
      <span style="display:inline-block;font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.18em;color:${INK_MUTED};text-transform:uppercase;">Momentella</span>
    </td></tr>
    ${eyebrow ? `<tr><td align="center" style="padding:8px 32px 0;"><span style="display:inline-block;font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.18em;color:${GOLD};text-transform:uppercase;">${eyebrow}</span></td></tr>` : ""}
    <tr><td align="left" style="padding:12px 32px 4px;">
      <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:1.2;font-weight:500;color:${INK};">${heading}</h1>
    </td></tr>
    ${intro ? `<tr><td style="padding:8px 32px 0;"><p style="margin:8px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.55;color:${INK_MUTED};">${intro}</p></td></tr>` : ""}
    ${opts.bodyHtml ? `<tr><td style="padding:8px 32px 0;color:${INK};font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.6;">${opts.bodyHtml}</td></tr>` : ""}
    ${
      cta
        ? `<tr><td align="left" style="padding:24px 32px 8px;">
        <a href="${escapeHtml(cta.href)}" style="display:inline-block;background-color:${INK};color:${CANVAS};font-family:'Helvetica Neue',Arial,sans-serif;font-weight:600;font-size:14px;text-decoration:none;padding:12px 22px;border-radius:999px;">${escapeHtml(cta.label)}</a>
      </td></tr>`
        : ""
    }
    <tr><td style="padding:24px 32px 28px;">
      <p style="margin:0;font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;color:${INK_MUTED};letter-spacing:0.06em;">
        ${footer || "Boutique family travel · momentella.com"}
      </p>
    </td></tr>
  </table>
  <p style="margin:16px 0 0;font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;color:${INK_MUTED};">${yearLine}</p>
</td></tr>
</table>
</body></html>`;
}

/** Plain-text fallback paragraph helper. */
export function plainTextLines(lines: string[]): string {
  return lines.filter(Boolean).join("\n");
}

/** Build a quote-styled HTML block from raw user text. */
export function quoteBlock(text: string): string {
  return `<blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid ${GOLD};background-color:${CANVAS};font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.5;color:${INK};">${escapeHtml(text).replace(/\n/g, "<br>")}</blockquote>`;
}
