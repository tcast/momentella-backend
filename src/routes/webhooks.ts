/**
 * Public, signature-verified webhook surface. Today: Resend inbound email
 * replies → posted into the matching trip thread.
 */

import type { FastifyPluginAsync } from "fastify";
import { Webhook } from "svix";
import { prisma } from "../lib/prisma.js";
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
};
