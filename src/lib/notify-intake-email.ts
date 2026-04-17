/**
 * Optional Resend notification when an intake is submitted.
 * Set RESEND_API_KEY and INTAKE_NOTIFICATION_EMAIL (or NOTIFY_EMAIL) on the API service.
 */
export async function sendIntakeNotificationEmail(opts: {
  formName: string;
  formSlug: string;
  submitterEmail: string;
  submissionId: string;
  summaryLines: string[];
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const to =
    process.env.INTAKE_NOTIFICATION_EMAIL ?? process.env.NOTIFY_EMAIL ?? "";
  const from =
    process.env.RESEND_FROM_EMAIL ?? "Momentella <onboarding@resend.dev>";

  if (!apiKey || !to) {
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[intake] RESEND_API_KEY or INTAKE_NOTIFICATION_EMAIL not set — skipping email notification",
      );
    }
    return;
  }

  const appUrl = process.env.CLIENT_APP_ORIGIN ?? process.env.BETTER_AUTH_URL ?? "";
  const detailPath = appUrl
    ? `${appUrl.replace(/\/$/, "")}/admin/intake/submissions/${opts.submissionId}`
    : "";

  const text = [
    `New trip intake — ${opts.formName} (${opts.formSlug})`,
    `From: ${opts.submitterEmail}`,
    `Submission id: ${opts.submissionId}`,
    detailPath ? `Open: ${detailPath}` : "",
    "",
    ...opts.summaryLines,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `[Momentella intake] ${opts.formName} — ${opts.submitterEmail}`,
      text,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("[intake] Resend error:", res.status, err);
  }
}
