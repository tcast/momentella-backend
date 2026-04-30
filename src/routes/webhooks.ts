/**
 * Public, signature-verified webhook surface. Today:
 *   - Resend inbound email replies → posted into the matching trip thread.
 *   - Stripe checkout.session.completed → fulfill the order (trip / gift).
 */

import type { FastifyPluginAsync } from "fastify";
import { Webhook } from "svix";
import type Stripe from "stripe";
import { fulfillCheckoutCompleted } from "../lib/commerce.js";
import { prisma } from "../lib/prisma.js";
import { getStripe, isStripeConfigured } from "../lib/stripe.js";
import {
  extractTripId,
  htmlToText,
  parseAddress,
  resolveSender,
  stripQuotedReply,
} from "../lib/inbound-email.js";
import { notifyNewMessage } from "../lib/trip-notifications.js";

interface ResendInboundEvent {
  /** "email.inbound" or similar — string, varies by version. */
  type?: string;
  data?: {
    /** "From: Name <email>" preserved or just "email". */
    from?: string;
    to?: string[] | string;
    subject?: string;
    text?: string;
    html?: string;
    headers?: Record<string, string>;
  };
}

/** Resend "email events" webhook payload (delivered / opened / bounced / etc). */
interface ResendEmailEvent {
  type?: string;
  created_at?: string;
  data?: {
    /** Resend's id — the value our `sendEmail` returns. */
    email_id?: string;
    /** Older payloads sometimes use `id`. */
    id?: string;
    from?: string;
    to?: string[] | string;
    subject?: string;
    /** Bounce diagnostics (varies by event type). */
    bounce?: { message?: string };
  };
}

function asArray(v: string[] | string | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/resend/inbound",
    { config: { rawBody: true } },
    async (request, reply) => {
      const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
      if (!secret) {
        app.log.warn("[webhook] RESEND_WEBHOOK_SECRET missing — refusing");
        return reply.status(503).send({ error: "Webhook not configured" });
      }
      const raw = (request as { rawBody?: string }).rawBody;
      if (!raw) {
        return reply.status(400).send({ error: "Missing raw body" });
      }

      // svix-id, svix-timestamp, svix-signature on the request.
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(request.headers)) {
        if (typeof v === "string") headers[k.toLowerCase()] = v;
      }

      let event: ResendInboundEvent;
      try {
        const wh = new Webhook(secret);
        event = wh.verify(raw, headers) as ResendInboundEvent;
      } catch (err) {
        app.log.warn({ err }, "[webhook] signature verification failed");
        return reply.status(401).send({ error: "Invalid signature" });
      }

      const data = event.data;
      if (!data) {
        // Subscription confirmations / non-email events — accept silently.
        return reply.status(200).send({ ok: true, ignored: true });
      }

      const toList = asArray(data.to);
      const tripId = extractTripId(toList);
      if (!tripId) {
        app.log.info({ to: toList }, "[webhook] no trip id in to address");
        return reply.status(200).send({ ok: true, ignored: "no_trip" });
      }

      const fromAddr = parseAddress(data.from);
      if (!fromAddr) {
        app.log.info({ from: data.from }, "[webhook] unparseable from");
        return reply.status(200).send({ ok: true, ignored: "bad_from" });
      }

      const sender = await resolveSender(tripId, fromAddr.email);
      if (!sender) {
        app.log.info(
          { tripId, from: fromAddr.email },
          "[webhook] sender not associated with trip",
        );
        return reply.status(200).send({ ok: true, ignored: "unknown_sender" });
      }

      // Prefer plain-text body; fall back to HTML-converted-to-text.
      const rawText =
        (typeof data.text === "string" && data.text.trim()) ||
        (typeof data.html === "string" && htmlToText(data.html)) ||
        "";
      const cleaned = stripQuotedReply(rawText);
      if (!cleaned) {
        app.log.info({ tripId }, "[webhook] empty after quote-strip");
        return reply.status(200).send({ ok: true, ignored: "empty_body" });
      }

      try {
        const message = await prisma.tripMessage.create({
          data: {
            tripId,
            authorId: sender.authorId,
            authorName: sender.authorName,
            authorRole: sender.authorRole,
            body: cleaned,
          },
        });
        // Email the *other* side via the same single-email-per-direction rule.
        void notifyNewMessage(message.id);
        return reply
          .status(200)
          .send({ ok: true, messageId: message.id, tripId });
      } catch (err) {
        app.log.error({ err }, "[webhook] failed to store message");
        return reply.status(500).send({ error: "Could not store message" });
      }
    },
  );

  /**
   * Resend "email events" webhook (delivered / opened / clicked / bounced).
   * Uses a separate secret from the inbound webhook because they're two
   * different webhook endpoints in the Resend dashboard.
   *
   * Today this only updates GiftCertificate rows — the only emails whose
   * Resend email_id we persist. Other tracked emails can opt in by adding
   * fields + a lookup branch below.
   */
  app.post(
    "/resend/events",
    { config: { rawBody: true } },
    async (request, reply) => {
      const secret =
        process.env.RESEND_EVENTS_WEBHOOK_SECRET?.trim() ||
        // Fall back to the inbound secret if you set up a single combined
        // webhook in Resend. Recommended split: separate secrets.
        process.env.RESEND_WEBHOOK_SECRET?.trim();
      if (!secret) {
        app.log.warn("[events] no RESEND_EVENTS_WEBHOOK_SECRET set");
        return reply.status(503).send({ error: "Webhook not configured" });
      }
      const raw = (request as { rawBody?: string }).rawBody;
      if (!raw) return reply.status(400).send({ error: "Missing raw body" });

      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(request.headers)) {
        if (typeof v === "string") headers[k.toLowerCase()] = v;
      }

      let event: ResendEmailEvent;
      try {
        const wh = new Webhook(secret);
        event = wh.verify(raw, headers) as ResendEmailEvent;
      } catch (err) {
        app.log.warn({ err }, "[events] signature verification failed");
        return reply.status(401).send({ error: "Invalid signature" });
      }

      const data = event.data;
      const emailId = data?.email_id ?? data?.id;
      const type = event.type ?? "";
      if (!emailId) {
        return reply.status(200).send({ ok: true, ignored: "no_email_id" });
      }

      const cert = await prisma.giftCertificate.findFirst({
        where: { resendEmailId: emailId },
        select: { id: true },
      });
      if (!cert) {
        // Not one of the emails we currently track — ack and move on.
        return reply.status(200).send({ ok: true, ignored: "no_match" });
      }

      const now = new Date();
      try {
        switch (type) {
          case "email.delivered":
            await prisma.giftCertificate.update({
              where: { id: cert.id },
              data: { deliveredAt: now },
            });
            break;
          case "email.opened":
            await prisma.giftCertificate.update({
              where: { id: cert.id },
              data: {
                firstOpenedAt: { set: undefined }, // see next call
                lastOpenedAt: now,
                openCount: { increment: 1 },
              },
            });
            // Set firstOpenedAt only if it's still null. Done as a separate
            // updateMany to avoid clobbering an existing value.
            await prisma.giftCertificate.updateMany({
              where: { id: cert.id, firstOpenedAt: null },
              data: { firstOpenedAt: now },
            });
            break;
          case "email.bounced":
            await prisma.giftCertificate.update({
              where: { id: cert.id },
              data: {
                bouncedAt: now,
                bounceReason: data?.bounce?.message ?? null,
              },
            });
            break;
          case "email.complained":
            // Treat as a soft signal we don't currently surface.
            break;
          case "email.clicked":
            // We can repurpose lastOpenedAt as "engaged" if helpful, but
            // not strictly necessary today.
            break;
          default:
            break;
        }
      } catch (err) {
        app.log.error({ err, type, emailId }, "[events] update failed");
        return reply.status(500).send({ error: "Update failed" });
      }
      return reply.status(200).send({ ok: true });
    },
  );

  // ── Stripe ────────────────────────────────────────────────────────────
  app.post(
    "/stripe",
    { config: { rawBody: true } },
    async (request, reply) => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
      if (!secret || !isStripeConfigured()) {
        app.log.warn("[stripe] webhook hit but Stripe isn't configured");
        return reply.status(503).send({ error: "Stripe not configured" });
      }
      const sig = request.headers["stripe-signature"];
      const raw = (request as { rawBody?: string }).rawBody;
      if (!raw || typeof sig !== "string") {
        return reply.status(400).send({ error: "Missing signature / body" });
      }
      const stripe = getStripe();
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(raw, sig, secret);
      } catch (err) {
        app.log.warn({ err }, "[stripe] signature verification failed");
        return reply.status(400).send({ error: "Invalid signature" });
      }

      try {
        switch (event.type) {
          case "checkout.session.completed": {
            const s = event.data.object as Stripe.Checkout.Session;
            if (s.id) {
              await fulfillCheckoutCompleted(s.id);
            }
            break;
          }
          case "checkout.session.async_payment_succeeded": {
            const s = event.data.object as Stripe.Checkout.Session;
            if (s.id) await fulfillCheckoutCompleted(s.id);
            break;
          }
          case "checkout.session.expired": {
            const s = event.data.object as Stripe.Checkout.Session;
            if (s.id) {
              await prisma.order.updateMany({
                where: { stripeCheckoutSessionId: s.id, status: "PENDING" },
                data: { status: "CANCELLED" },
              });
            }
            break;
          }
          case "charge.refunded": {
            const ch = event.data.object as Stripe.Charge;
            const pi =
              typeof ch.payment_intent === "string"
                ? ch.payment_intent
                : ch.payment_intent?.id;
            if (pi) {
              await prisma.order.updateMany({
                where: { stripePaymentIntentId: pi },
                data: { status: "REFUNDED", refundedAt: new Date() },
              });
            }
            break;
          }
          case "payment_intent.payment_failed": {
            const pi = event.data.object as Stripe.PaymentIntent;
            await prisma.order.updateMany({
              where: { stripePaymentIntentId: pi.id },
              data: { status: "FAILED" },
            });
            break;
          }
          default:
            // ignore — many events fire we don't care about
            break;
        }
      } catch (err) {
        app.log.error({ err, type: event.type }, "[stripe] handler failed");
        return reply.status(500).send({ error: "Handler failed" });
      }

      return reply.status(200).send({ received: true });
    },
  );
};
