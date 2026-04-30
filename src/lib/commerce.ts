/**
 * The fulfillment layer that sits between Stripe and our DB. Two entry points:
 *
 *   - createCheckoutSession: builds a Stripe Checkout Session for a product
 *     (self-purchase or gift), persists a PENDING Order, and returns the
 *     redirect URL.
 *
 *   - fulfillCheckoutCompleted: called by the Stripe webhook on successful
 *     payment. Idempotent: runs the trip-or-gift creation, sends the right
 *     emails, and marks the Order PAID. Safe to retry.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "./prisma.js";
import { appOrigin, getStripe } from "./stripe.js";
import {
  appOrigin as mailAppOrigin,
  brandedEmailHtml,
  plainTextLines,
  quoteBlock,
  sendEmail,
  teamAlertEmails,
} from "./mailer.js";
import { sendIntakeNotificationEmail as _unused } from "./notify-intake-email.js";
import type { Order, Product } from "@prisma/client";

void _unused; // avoid lint: keep the export visible for downstream

function newClientUserId(): string {
  return randomBytes(24).toString("base64url").slice(0, 32);
}

function newGiftCode(): string {
  // 4-4-4 grouping of crockford-ish base32 (no I, L, 0, O ambiguity).
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  function group() {
    let s = "";
    const bytes = randomBytes(4);
    for (let i = 0; i < 4; i++) s += alphabet[bytes[i]! % alphabet.length];
    return s;
  }
  return `MOM-${group()}-${group()}`;
}

/**
 * Make sure a User exists for `email`. Returns existing or creates a fresh
 * client account. Doesn't set a password — the buyer/recipient will use a
 * magic link to claim/sign in later.
 */
export async function ensureClientUser(opts: {
  email: string;
  name?: string | null;
}): Promise<{ id: string; email: string; name: string; createdNow: boolean }> {
  const lower = opts.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: lower } });
  if (existing) {
    if (!existing.role) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: "client" },
      });
    }
    return {
      id: existing.id,
      email: existing.email,
      name: existing.name,
      createdNow: false,
    };
  }
  const created = await prisma.user.create({
    data: {
      id: newClientUserId(),
      email: lower,
      name:
        opts.name?.trim() ||
        lower.split("@")[0]!.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      emailVerified: false,
      role: "client",
    },
  });
  return {
    id: created.id,
    email: created.email,
    name: created.name,
    createdNow: true,
  };
}

export interface StartCheckoutOptions {
  product: Product;
  buyerEmail: string;
  buyerName?: string | null;
  isGift: boolean;
  recipientEmail?: string;
  recipientName?: string;
  giftMessage?: string;
}

export async function createCheckoutSession(
  opts: StartCheckoutOptions,
): Promise<{ url: string; orderId: string }> {
  if (!opts.product.active) {
    throw new Error("This product isn't available right now.");
  }
  const stripe = getStripe();

  const totalCents = opts.product.priceCents;
  const order = await prisma.order.create({
    data: {
      productId: opts.product.id,
      buyerEmail: opts.buyerEmail.trim().toLowerCase(),
      buyerName: opts.buyerName?.trim() || null,
      unitPriceCents: opts.product.priceCents,
      quantity: 1,
      totalCents,
      status: "PENDING",
      isGift: opts.isGift,
    },
  });

  const origin = appOrigin();

  // If we don't have a Stripe Price ID cached, sync now (one-shot).
  let priceId = opts.product.stripePriceId;
  if (!priceId) {
    const synced = await import("./stripe.js").then((m) =>
      m.syncProductToStripe(opts.product),
    );
    priceId = synced.stripePriceId;
    await prisma.product.update({
      where: { id: opts.product.id },
      data: { stripePriceId: priceId },
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: opts.buyerEmail,
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout/cancel?order_id=${order.id}`,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: {
      order_id: order.id,
      product_slug: opts.product.slug,
      is_gift: opts.isGift ? "1" : "0",
      buyer_name: opts.buyerName ?? "",
      recipient_email: opts.recipientEmail ?? "",
      recipient_name: opts.recipientName ?? "",
      gift_message: (opts.giftMessage ?? "").slice(0, 480),
    },
  });

  await prisma.order.update({
    where: { id: order.id },
    data: { stripeCheckoutSessionId: session.id },
  });

  if (!session.url) {
    throw new Error("Stripe didn't return a checkout URL.");
  }
  return { url: session.url, orderId: order.id };
}

interface FulfillResult {
  orderId: string;
  alreadyFulfilled: boolean;
  tripId?: string;
  giftCertificateId?: string;
}

/**
 * Idempotent: if the order is already PAID we don't run side effects again.
 * The Stripe webhook can fire multiple times legitimately; we hold the line
 * here.
 */
export async function fulfillCheckoutCompleted(
  sessionId: string,
): Promise<FulfillResult | null> {
  const order = await prisma.order.findUnique({
    where: { stripeCheckoutSessionId: sessionId },
    include: { product: true, giftCertificate: true, trips: true },
  });
  if (!order) return null;
  if (order.status === "PAID") {
    return {
      orderId: order.id,
      alreadyFulfilled: true,
      tripId: order.trips[0]?.id,
      giftCertificateId: order.giftCertificate?.id,
    };
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const md = (session.metadata ?? {}) as Record<string, string>;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const result: FulfillResult = { orderId: order.id, alreadyFulfilled: false };

  await prisma.order.update({
    where: { id: order.id },
    data: {
      status: "PAID",
      paidAt: new Date(),
      stripePaymentIntentId: paymentIntentId,
    },
  });

  // Self-purchase → make the buyer's account + Trip immediately.
  if (!order.isGift) {
    const buyer = await ensureClientUser({
      email: order.buyerEmail,
      name: md.buyer_name || order.buyerName,
    });
    const trip = await prisma.trip.create({
      data: {
        clientId: buyer.id,
        title: `${order.product.name} — ${buyer.name}`,
        kind: "ITINERARY_ONLY",
        status: "LEAD",
        fulfilledByOrderId: order.id,
        productSlug: order.product.slug,
        itineraryDaysAllowed: order.product.itineraryDays,
      },
    });
    result.tripId = trip.id;
    await sendBuyerOrderEmail(order, buyer, trip.id).catch((e) =>
      console.error("[commerce] buyer email failed:", e),
    );
    await sendTeamOrderAlert(order, "purchase").catch((e) =>
      console.error("[commerce] team alert failed:", e),
    );
    return result;
  }

  // Gift purchase → make the buyer's account, create the GiftCertificate,
  // send the recipient the gift email.
  const buyer = await ensureClientUser({
    email: order.buyerEmail,
    name: md.buyer_name || order.buyerName,
  });
  const code = newGiftCode();
  const recipientEmail = (md.recipient_email || "").trim().toLowerCase();
  const recipientName = md.recipient_name?.trim() || null;
  const message = md.gift_message?.trim() || null;
  if (!recipientEmail) {
    throw new Error("Gift order missing recipient email in metadata.");
  }
  const cert = await prisma.giftCertificate.create({
    data: {
      orderId: order.id,
      code,
      recipientEmail,
      recipientName,
      message,
    },
  });
  result.giftCertificateId = cert.id;

  await Promise.all([
    sendGiftRecipientEmail(order, buyer, cert).catch((e) =>
      console.error("[commerce] gift recipient email failed:", e),
    ),
    sendBuyerGiftConfirmationEmail(order, buyer, cert).catch((e) =>
      console.error("[commerce] gift buyer email failed:", e),
    ),
    sendTeamOrderAlert(order, "gift", { recipientEmail, recipientName }).catch(
      (e) => console.error("[commerce] team alert failed:", e),
    ),
  ]);
  await prisma.giftCertificate.update({
    where: { id: cert.id },
    data: { sentAt: new Date() },
  });
  return result;
}

/**
 * Recipient redeems a gift certificate. Creates / promotes the recipient's
 * client account, links the cert, and creates the fulfillment Trip.
 */
export async function redeemGiftCertificate(
  code: string,
  redeemer: { email: string; name?: string | null; userId?: string },
): Promise<{ tripId: string; userId: string }> {
  const cert = await prisma.giftCertificate.findUnique({
    where: { code },
    include: { order: { include: { product: true, buyer: true } } },
  });
  if (!cert) throw new Error("That gift code doesn't match anything.");
  if (cert.redeemedTripId) {
    return {
      tripId: cert.redeemedTripId,
      userId: cert.redeemedById ?? redeemer.userId ?? "",
    };
  }
  const user = redeemer.userId
    ? await prisma.user
        .findUnique({ where: { id: redeemer.userId } })
        .then((u) =>
          u
            ? {
                id: u.id,
                email: u.email,
                name: u.name,
                createdNow: false,
              }
            : ensureClientUser({ email: redeemer.email, name: redeemer.name }),
        )
    : await ensureClientUser({
        email: redeemer.email,
        name: redeemer.name,
      });

  const trip = await prisma.trip.create({
    data: {
      clientId: user.id,
      title: `${cert.order.product.name} — ${user.name}`,
      kind: "ITINERARY_ONLY",
      status: "LEAD",
      fulfilledByOrderId: cert.order.id,
      productSlug: cert.order.product.slug,
      itineraryDaysAllowed: cert.order.product.itineraryDays,
    },
  });
  await prisma.giftCertificate.update({
    where: { id: cert.id },
    data: {
      redeemedAt: new Date(),
      redeemedById: user.id,
      redeemedTripId: trip.id,
    },
  });

  // Tell the buyer their gift was redeemed.
  if (cert.order.buyer?.email) {
    await sendGiftRedeemedToBuyerEmail(cert, user).catch((e) =>
      console.error("[commerce] gift redeemed email failed:", e),
    );
  }
  await sendTeamOrderAlert(cert.order, "gift_redeemed", {
    recipientEmail: user.email,
    recipientName: user.name,
  }).catch((e) => console.error("[commerce] team alert failed:", e));

  return { tripId: trip.id, userId: user.id };
}

/**
 * Re-send the original gift recipient email. Useful when the recipient lost
 * the original or it landed in spam. Updates the cert's `sentAt` timestamp.
 */
export async function resendGiftRecipientEmail(certId: string): Promise<void> {
  const cert = await prisma.giftCertificate.findUnique({
    where: { id: certId },
    include: {
      order: {
        include: {
          product: true,
          buyer: true,
        },
      },
    },
  });
  if (!cert) throw new Error("Gift certificate not found.");
  if (cert.redeemedAt) {
    throw new Error("That gift has already been redeemed.");
  }
  const buyer = cert.order.buyer
    ? { name: cert.order.buyer.name ?? cert.order.buyerName ?? cert.order.buyerEmail, email: cert.order.buyer.email }
    : { name: cert.order.buyerName ?? cert.order.buyerEmail, email: cert.order.buyerEmail };
  await sendGiftRecipientEmail(cert.order, buyer, {
    code: cert.code,
    recipientEmail: cert.recipientEmail,
    recipientName: cert.recipientName,
    message: cert.message,
  });
  await prisma.giftCertificate.update({
    where: { id: cert.id },
    data: { sentAt: new Date() },
  });
}

// ── emails ──────────────────────────────────────────────────────────────

function dollars(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

async function sendBuyerOrderEmail(
  order: Order & { product: Product },
  buyer: { email: string; name: string },
  tripId: string,
) {
  const portal = `${mailAppOrigin()}/dashboard/trips/${tripId}`;
  const html = brandedEmailHtml({
    eyebrow: "Thanks for your order",
    heading: `Your ${order.product.name} is ready to plan`,
    intro: `Total ${dollars(order.totalCents)}. We'll start designing right away — keep an eye on your portal for the first proposal.`,
    bodyHtml: order.product.description
      ? `<p style="margin:0;">${order.product.description}</p>`
      : "",
    cta: { label: "Open your trip", href: portal },
    footerNote: "Reply to this email to reach your designer.",
  });
  await sendEmail({
    to: buyer.email,
    subject: `Your Momentella ${order.product.name} order — confirmed`,
    html,
    text: plainTextLines([
      `Hi ${buyer.name.split(" ")[0]},`,
      "",
      `Your ${order.product.name} (${dollars(order.totalCents)}) is confirmed.`,
      `Open your trip: ${portal}`,
    ]),
  });
}

async function sendBuyerGiftConfirmationEmail(
  order: Order & { product: Product },
  buyer: { email: string; name: string },
  cert: { recipientEmail: string; recipientName: string | null },
) {
  const html = brandedEmailHtml({
    eyebrow: "Your gift is on its way",
    heading: `${order.product.name} — sent to ${cert.recipientName ?? cert.recipientEmail}`,
    intro: `Total ${dollars(order.totalCents)}. They'll receive an email with the redemption link in the next minute or two.`,
    footerNote: "We'll send another email once they redeem.",
  });
  await sendEmail({
    to: buyer.email,
    subject: `Gift sent: ${order.product.name} for ${cert.recipientName ?? cert.recipientEmail}`,
    html,
    text: plainTextLines([
      `Hi ${buyer.name.split(" ")[0]},`,
      "",
      `Your gift of ${order.product.name} (${dollars(order.totalCents)}) is on its way to ${cert.recipientName ?? cert.recipientEmail}.`,
    ]),
  });
}

async function sendGiftRecipientEmail(
  order: Order & { product: Product },
  buyer: { name: string; email: string },
  cert: {
    code: string;
    recipientEmail: string;
    recipientName: string | null;
    message: string | null;
  },
) {
  const link = `${mailAppOrigin()}/redeem/${encodeURIComponent(cert.code)}`;
  const intro = `${buyer.name} sent you a Momentella ${order.product.name}. Click below to set up your account and start planning.`;
  const html = brandedEmailHtml({
    eyebrow: "A gift from a friend",
    heading: `${buyer.name} sent you ${order.product.name}`,
    intro,
    bodyHtml: cert.message
      ? `<p style="margin:0 0 8px;">A note from ${buyer.name}:</p>${quoteBlock(cert.message)}`
      : undefined,
    cta: { label: "Redeem your gift", href: link },
    footerNote: `Your code: ${cert.code} (works at ${link})`,
  });
  await sendEmail({
    to: cert.recipientEmail,
    subject: `${buyer.name} sent you a Momentella ${order.product.name}`,
    html,
    text: plainTextLines([
      `Hi ${(cert.recipientName ?? cert.recipientEmail).split(" ")[0]},`,
      "",
      `${buyer.name} sent you a Momentella ${order.product.name}.`,
      cert.message ? `\n${cert.message}\n` : "",
      `Redeem here: ${link}`,
      `Code: ${cert.code}`,
    ]),
  });
}

async function sendGiftRedeemedToBuyerEmail(
  cert: {
    order: Order & { product: Product; buyer: { name: string; email: string } | null };
    recipientEmail: string;
    recipientName: string | null;
  },
  redeemer: { name: string; email: string },
) {
  const buyer = cert.order.buyer;
  if (!buyer) return;
  const html = brandedEmailHtml({
    eyebrow: "Your gift was redeemed",
    heading: `${redeemer.name} just redeemed your gift`,
    intro: `${redeemer.name} accepted your ${cert.order.product.name}. They're all set up — your trip designer is taking it from here.`,
  });
  await sendEmail({
    to: buyer.email,
    subject: `${redeemer.name} redeemed your Momentella gift`,
    html,
    text: plainTextLines([
      `Hi ${buyer.name.split(" ")[0]},`,
      "",
      `${redeemer.name} just redeemed your gift of ${cert.order.product.name}.`,
    ]),
  });
}

async function sendTeamOrderAlert(
  order: Order & { product: Product },
  kind: "purchase" | "gift" | "gift_redeemed",
  meta?: { recipientEmail?: string; recipientName?: string | null },
) {
  const team = teamAlertEmails();
  if (team.length === 0) return;
  const subject =
    kind === "purchase"
      ? `[Momentella] New order: ${order.product.name} — ${dollars(order.totalCents)}`
      : kind === "gift"
        ? `[Momentella] Gift sent: ${order.product.name} — ${dollars(order.totalCents)}`
        : `[Momentella] Gift redeemed: ${order.product.name}`;
  const heading =
    kind === "gift_redeemed"
      ? `${meta?.recipientName ?? meta?.recipientEmail ?? "Recipient"} redeemed a gift`
      : kind === "gift"
        ? `Gift sent`
        : `New order`;
  const lines: string[] = [
    `Buyer: ${order.buyerName ?? ""} <${order.buyerEmail}>`,
    `Product: ${order.product.name}`,
    `Amount: ${dollars(order.totalCents)}`,
  ];
  if (kind === "gift" || kind === "gift_redeemed") {
    lines.push(
      `Recipient: ${meta?.recipientName ?? ""} <${meta?.recipientEmail ?? ""}>`,
    );
  }
  const adminUrl = `${mailAppOrigin()}/admin/orders`;
  const html = brandedEmailHtml({
    eyebrow: "Sale alert",
    heading,
    intro: lines.join(" · "),
    cta: { label: "Open in admin", href: adminUrl },
    footerNote: "You're receiving this because you're on the team alerts list.",
  });
  await sendEmail({ to: team, subject, html, text: lines.join("\n") });
}
