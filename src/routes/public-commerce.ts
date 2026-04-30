import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { auth } from "../lib/auth.js";
import {
  createCheckoutSession,
  redeemGiftCertificate,
} from "../lib/commerce.js";
import { isStripeConfigured } from "../lib/stripe.js";
import { getSession } from "../lib/request-session.js";
import { appOrigin } from "../lib/mailer.js";

/** Mounted at /api/public/commerce — no auth required. */
export const publicCommerceRoutes: FastifyPluginAsync = async (app) => {
  app.get("/products", async () => {
    const products = await prisma.product.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }],
      select: {
        id: true,
        slug: true,
        kind: true,
        name: true,
        description: true,
        itineraryDays: true,
        priceCents: true,
      },
    });
    return { products };
  });

  app.post("/checkout", async (request, reply) => {
    if (!isStripeConfigured()) {
      return reply.status(503).send({
        error:
          "Checkout isn't available yet — ask the team to finish setting up Stripe.",
      });
    }
    const body = request.body as {
      productSlug?: string;
      buyerEmail?: string;
      buyerName?: string;
      isGift?: boolean;
      recipientEmail?: string;
      recipientName?: string;
      giftMessage?: string;
    };
    const slug = body.productSlug?.trim();
    const buyerEmail = body.buyerEmail?.trim().toLowerCase();
    if (!slug) return reply.status(400).send({ error: "productSlug required" });
    if (!buyerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail)) {
      return reply.status(400).send({ error: "Valid buyer email required" });
    }
    const product = await prisma.product.findUnique({ where: { slug } });
    if (!product || !product.active) {
      return reply.status(404).send({ error: "Product not found" });
    }
    const isGift = !!body.isGift;
    if (isGift) {
      const re = body.recipientEmail?.trim().toLowerCase();
      if (!re || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(re)) {
        return reply
          .status(400)
          .send({ error: "Valid recipient email required for gifts" });
      }
    }
    try {
      const out = await createCheckoutSession({
        product,
        buyerEmail,
        buyerName: body.buyerName ?? null,
        isGift,
        recipientEmail: body.recipientEmail,
        recipientName: body.recipientName,
        giftMessage: body.giftMessage,
      });
      return reply.status(201).send(out);
    } catch (err) {
      app.log.error({ err }, "checkout session create failed");
      return reply.status(500).send({ error: "Could not start checkout" });
    }
  });

  /**
   * Used by /checkout/success after Stripe redirects back. Returns minimal
   * order info; falls back to a friendly state if the webhook hasn't run yet.
   */
  app.get("/checkout/status", async (request) => {
    const q = request.query as { session_id?: string };
    if (!q.session_id) return { status: "missing_session" };
    const order = await prisma.order.findUnique({
      where: { stripeCheckoutSessionId: q.session_id },
      include: {
        product: {
          select: { name: true, slug: true, itineraryDays: true },
        },
        trips: {
          select: { id: true, title: true, clientId: true },
          take: 1,
        },
        giftCertificate: {
          select: {
            id: true,
            code: true,
            recipientEmail: true,
            recipientName: true,
          },
        },
      },
    });
    if (!order) return { status: "missing_order" };
    return {
      status: order.status,
      isGift: order.isGift,
      product: order.product,
      trip: order.trips[0] ?? null,
      giftCertificate: order.giftCertificate ?? null,
      buyerEmail: order.buyerEmail,
      buyerName: order.buyerName,
      totalCents: order.totalCents,
    };
  });

  app.get("/gift-certificates/:code", async (request, reply) => {
    const { code } = request.params as { code: string };
    const cert = await prisma.giftCertificate.findUnique({
      where: { code },
      include: {
        order: {
          include: {
            product: {
              select: { name: true, slug: true, itineraryDays: true, description: true },
            },
            buyer: { select: { name: true, email: true } },
          },
        },
      },
    });
    if (!cert) return reply.status(404).send({ error: "Gift not found" });
    return {
      code: cert.code,
      recipientEmail: cert.recipientEmail,
      recipientName: cert.recipientName,
      message: cert.message,
      redeemedAt: cert.redeemedAt,
      buyer: cert.order.buyer
        ? { name: cert.order.buyer.name, email: cert.order.buyer.email }
        : null,
      buyerName: cert.order.buyerName,
      product: cert.order.product,
    };
  });

  app.post("/gift-certificates/:code/redeem", async (request, reply) => {
    const { code } = request.params as { code: string };
    const body = request.body as { email?: string; name?: string };
    const session = await getSession(request);
    const email = session?.user?.email ?? body.email?.trim().toLowerCase();
    const name = session?.user?.name ?? body.name?.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.status(400).send({ error: "Valid email required" });
    }
    try {
      const out = await redeemGiftCertificate(code, {
        email,
        name,
        userId: session?.user?.id,
      });
      // If the redeemer is already signed in, no extra step needed.
      // Otherwise, fire a magic link so they can land in their portal.
      let signInState: "already_signed_in" | "magic_link_sent" =
        "already_signed_in";
      if (!session?.user) {
        const callbackURL = `${appOrigin()}/dashboard/trips/${out.tripId}`;
        try {
          await auth.api.signInMagicLink({
            body: { email, callbackURL, name: name ?? undefined },
            headers: request.headers as unknown as Record<string, string>,
          });
          signInState = "magic_link_sent";
        } catch (err) {
          app.log.warn(
            { err, email },
            "[redeem] magic-link send failed; recipient must sign in manually",
          );
        }
      }
      return reply
        .status(200)
        .send({ ...out, signInState, redeemerEmail: email });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not redeem";
      return reply.status(400).send({ error: msg });
    }
  });
};
