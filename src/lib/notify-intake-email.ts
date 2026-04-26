/**
 * Admin alert when an intake is submitted. Uses the shared mailer so
 * everything is branded + reads the same env vars (RESEND_API_KEY,
 * RESEND_FROM, RESEND_TEAM_EMAILS).
 */
import {
  appOrigin,
  brandedEmailHtml,
  plainTextLines,
  quoteBlock,
  sendEmail,
  teamAlertEmails,
} from "./mailer.js";

/**
 * Backwards-compatible export. Routes call this fire-and-forget on submit.
 */
export async function sendIntakeNotificationEmail(opts: {
  formName: string;
  formSlug: string;
  submitterEmail: string;
  submissionId: string;
  summaryLines: string[];
}): Promise<void> {
  const recipients =
    teamAlertEmails().length > 0
      ? teamAlertEmails()
      : (() => {
          // Backwards-compat: honor old single-recipient env vars if present.
          const legacy =
            process.env.INTAKE_NOTIFICATION_EMAIL?.trim() ||
            process.env.NOTIFY_EMAIL?.trim();
          return legacy ? [legacy] : [];
        })();

  if (recipients.length === 0) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[intake] No team email configured — skipping intake notification.",
      );
    }
    return;
  }

  const portal = appOrigin();
  const detailPath = portal
    ? `${portal}/admin/intake/submissions/${opts.submissionId}`
    : null;

  const summary = opts.summaryLines.length
    ? `<ul style="margin:12px 0;padding:0 0 0 18px;color:#1c1917;font-family:Georgia,'Times New Roman',serif;font-size:14px;line-height:1.5;">${opts.summaryLines
        .map((l) => `<li style="margin:4px 0;">${escape(l)}</li>`)
        .join("")}</ul>`
    : "<p>(No answers yet — open the submission to see what was sent.)</p>";

  const html = brandedEmailHtml({
    preheader: `${opts.formName} — ${opts.submitterEmail}`,
    eyebrow: "New trip intake",
    heading: `${opts.formName}`,
    intro: `Submitted by ${opts.submitterEmail}.`,
    bodyHtml: summary,
    cta: detailPath
      ? { label: "Open submission in admin", href: detailPath }
      : undefined,
    footerNote: "You're receiving this because you're on the Momentella team alerts list.",
  });

  const text = plainTextLines([
    `New trip intake — ${opts.formName}`,
    `From: ${opts.submitterEmail}`,
    detailPath ? `Open: ${detailPath}` : "",
    "",
    ...opts.summaryLines,
  ]);

  try {
    await sendEmail({
      to: recipients,
      subject: `[Momentella intake] ${opts.formName} — ${opts.submitterEmail}`,
      html,
      text,
    });
  } catch (err) {
    console.error("[intake] notification send failed:", err);
  }
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
// `quoteBlock` re-exported only so build never marks it unused.
export { quoteBlock };
