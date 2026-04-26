/**
 * Per-trip email notifications. All firings are fire-and-forget; mail
 * failures are logged but never block the API response.
 */
import { prisma } from "./prisma.js";
import {
  appOrigin,
  brandedEmailHtml,
  plainTextLines,
  quoteBlock,
  sendEmail,
  teamAlertEmails,
} from "./mailer.js";

function clientPortalUrl(tripId: string): string {
  const o = appOrigin();
  return o ? `${o}/dashboard/trips/${tripId}` : "";
}

function adminTripUrl(tripId: string): string {
  const o = appOrigin();
  return o ? `${o}/admin/trips/${tripId}` : "";
}

/**
 * Fire when an admin publishes a new proposal. Notifies the trip's client.
 */
export async function notifyProposalPublished(
  proposalId: string,
): Promise<void> {
  try {
    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
      include: {
        trip: {
          include: {
            client: { select: { email: true, name: true } },
          },
        },
      },
    });
    if (!proposal) return;
    const client = proposal.trip.client;
    if (!client?.email) return;

    const portal = clientPortalUrl(proposal.trip.id);
    const greeting = client.name?.split(/\s+/)[0] || "there";
    const body = [
      proposal.message
        ? `<p style="margin:0 0 12px;">A note from your trip designer:</p>${quoteBlock(proposal.message)}`
        : "",
      `<p style="margin:16px 0 0;">Take a look when you have a moment, then approve or request changes — your designer will see your response right away.</p>`,
    ].join("");

    const html = brandedEmailHtml({
      preheader: `Your trip designer just published v${proposal.version} — take a look.`,
      eyebrow: `Proposal v${proposal.version}`,
      heading: `Hi ${greeting} — your trip is ready to review`,
      intro: `${proposal.trip.title} — published ${new Date(
        proposal.createdAt,
      ).toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      })}.`,
      bodyHtml: body,
      cta: portal ? { label: "View your trip", href: portal } : undefined,
      footerNote: "Reply to this email anytime to reach your designer.",
    });

    const text = plainTextLines([
      `Hi ${greeting},`,
      "",
      `Your Momentella trip designer just published v${proposal.version} of "${proposal.trip.title}".`,
      proposal.message ? `\n${proposal.message}\n` : "",
      portal ? `Open it here: ${portal}` : "",
      "",
      "— Momentella",
    ]);

    await sendEmail({
      to: client.email,
      subject: `Your Momentella trip is ready to review — ${proposal.trip.title}`,
      html,
      text,
    });
  } catch (err) {
    console.error("[notify] proposal published failed:", err);
  }
}

/**
 * Fire when a client approves or requests changes on a proposal.
 * Notifies the team.
 */
export async function notifyProposalResponded(
  proposalId: string,
): Promise<void> {
  try {
    const proposal = await prisma.proposal.findUnique({
      where: { id: proposalId },
      include: {
        trip: {
          include: { client: { select: { email: true, name: true } } },
        },
      },
    });
    if (!proposal) return;
    const team = teamAlertEmails();
    if (team.length === 0) return;

    const decisionLabel =
      proposal.status === "APPROVED"
        ? "approved"
        : proposal.status === "CHANGES_REQUESTED"
          ? "requested changes on"
          : "responded to";
    const url = adminTripUrl(proposal.trip.id);
    const clientName =
      proposal.trip.client?.name ||
      proposal.trip.client?.email ||
      "The client";

    const body = [
      `<p style="margin:0;">${escape(clientName)} ${escape(decisionLabel)} <strong>v${proposal.version}</strong> of <em>${escape(proposal.trip.title)}</em>.</p>`,
      proposal.responseNote
        ? `<p style="margin:16px 0 0;">Their note:</p>${quoteBlock(proposal.responseNote)}`
        : "",
    ].join("");

    const html = brandedEmailHtml({
      preheader: `${clientName} ${decisionLabel} v${proposal.version}.`,
      eyebrow:
        proposal.status === "APPROVED"
          ? "Proposal approved"
          : "Changes requested",
      heading: `${clientName} ${decisionLabel} the trip`,
      intro: `${proposal.trip.title}`,
      bodyHtml: body,
      cta: url ? { label: "Open trip in admin", href: url } : undefined,
      footerNote: "Sent because you're on the Momentella team alerts list.",
    });

    const text = plainTextLines([
      `${clientName} ${decisionLabel} v${proposal.version} of "${proposal.trip.title}".`,
      proposal.responseNote ? `Note: ${proposal.responseNote}` : "",
      url ? `Open: ${url}` : "",
    ]);

    await sendEmail({
      to: team,
      subject: `[Momentella] ${clientName} ${decisionLabel} v${proposal.version} — ${proposal.trip.title}`,
      html,
      text,
    });
  } catch (err) {
    console.error("[notify] proposal responded failed:", err);
  }
}

/**
 * Fire when a new trip message is posted. Notifies the OTHER side, but
 * only if the previous message in the thread came from a different role
 * (so 5 admin messages in a row produce 1 client email, not 5).
 */
export async function notifyNewMessage(messageId: string): Promise<void> {
  try {
    const msg = await prisma.tripMessage.findUnique({
      where: { id: messageId },
      include: {
        trip: {
          include: {
            client: { select: { email: true, name: true } },
          },
        },
      },
    });
    if (!msg) return;
    // Look at the message right before this one in the same thread.
    const prev = await prisma.tripMessage.findFirst({
      where: {
        tripId: msg.tripId,
        createdAt: { lt: msg.createdAt },
      },
      orderBy: { createdAt: "desc" },
    });
    // If the previous message was from the same role, this is part of
    // the same "burst" — skip the email. Treat empty thread as new.
    if (prev && prev.authorRole === msg.authorRole) return;

    const isAdmin = msg.authorRole === "admin";
    if (isAdmin) {
      // Notify the client.
      const client = msg.trip.client;
      if (!client?.email) return;
      const portal = clientPortalUrl(msg.trip.id);
      const greeting = client.name?.split(/\s+/)[0] || "there";
      const html = brandedEmailHtml({
        preheader: `${msg.authorName ?? "Your Momentella designer"} sent you a message about ${msg.trip.title}.`,
        eyebrow: "New message",
        heading: `Hi ${greeting} — a note from your trip designer`,
        intro: msg.trip.title,
        bodyHtml: quoteBlock(msg.body),
        cta: portal
          ? { label: "Reply on your portal", href: portal }
          : undefined,
        footerNote: "You can also reply to this email — your designer will see it.",
      });
      const text = plainTextLines([
        `Hi ${greeting},`,
        "",
        `${msg.authorName ?? "Your Momentella designer"} just sent you a message about "${msg.trip.title}":`,
        "",
        msg.body,
        "",
        portal ? `Reply on the portal: ${portal}` : "",
      ]);
      await sendEmail({
        to: client.email,
        subject: `New message about your trip — ${msg.trip.title}`,
        html,
        text,
      });
    } else {
      // Notify the team.
      const team = teamAlertEmails();
      if (team.length === 0) return;
      const url = adminTripUrl(msg.trip.id);
      const html = brandedEmailHtml({
        preheader: `${msg.authorName ?? "Client"} replied on ${msg.trip.title}.`,
        eyebrow: "New client message",
        heading: `${msg.authorName ?? "A client"} replied`,
        intro: msg.trip.title,
        bodyHtml: quoteBlock(msg.body),
        cta: url ? { label: "Open trip in admin", href: url } : undefined,
        footerNote: "Sent because you're on the Momentella team alerts list.",
      });
      const text = plainTextLines([
        `${msg.authorName ?? "A client"} replied on "${msg.trip.title}":`,
        "",
        msg.body,
        "",
        url ? `Open: ${url}` : "",
      ]);
      await sendEmail({
        to: team,
        subject: `[Momentella] ${msg.authorName ?? "Client"} replied — ${msg.trip.title}`,
        html,
        text,
      });
    }
  } catch (err) {
    console.error("[notify] new message failed:", err);
  }
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
