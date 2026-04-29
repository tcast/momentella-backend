/**
 * Lazy Stripe client. Reads STRIPE_SECRET_KEY at first use so the rest of
 * the app keeps working when Stripe isn't configured (admins can still log in,
 * see the catalog as drafts, etc.).
 */

import Stripe from "stripe";

let cached: Stripe | null = null;

export class StripeNotConfigured extends Error {
  constructor() {
    super(
      "Stripe is not configured. Set STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET for webhooks).",
    );
    this.name = "StripeNotConfigured";
  }
}

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new StripeNotConfigured();
  cached = new Stripe(key, {
    apiVersion: "2026-04-22.dahlia",
    typescript: true,
  });
  return cached;
}

export function appOrigin(): string {
  return (
    process.env.CLIENT_APP_ORIGIN?.replace(/\/$/, "") ??
    process.env.BETTER_AUTH_URL?.replace(/\/$/, "") ??
    "https://momentella.com"
  );
}

/**
 * Create or upsert a Stripe Product + Price for our local Product. Idempotent
 * on `metadata.product_slug` for the Product (so re-running won't duplicate),
 * and creates a fresh Price each call (Stripe Prices are immutable; if the
 * cents amount changed we want a new one and stash its id).
 */
export async function syncProductToStripe(p: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  stripePriceId: string | null;
}): Promise<{ stripeProductId: string; stripePriceId: string }> {
  const stripe = getStripe();

  // Find or create the Stripe Product.
  let stripeProduct: Stripe.Product | null = null;
  const found = await stripe.products.search({
    query: `metadata['product_slug']:'${p.slug}'`,
    limit: 1,
  });
  if (found.data[0]) {
    stripeProduct = found.data[0];
    // Keep its name + description in sync.
    if (
      stripeProduct.name !== p.name ||
      (stripeProduct.description ?? "") !== (p.description ?? "")
    ) {
      stripeProduct = await stripe.products.update(stripeProduct.id, {
        name: p.name,
        description: p.description ?? undefined,
      });
    }
  } else {
    stripeProduct = await stripe.products.create({
      name: p.name,
      description: p.description ?? undefined,
      metadata: { product_slug: p.slug, momentella_product_id: p.id },
    });
  }

  // Reuse the existing Price if its unit_amount matches; otherwise create a
  // new one and deactivate the old one. Stripe Prices are immutable.
  let stripePriceId = p.stripePriceId;
  if (stripePriceId) {
    try {
      const existing = await stripe.prices.retrieve(stripePriceId);
      if (
        existing.active &&
        existing.unit_amount === p.priceCents &&
        existing.currency === "usd"
      ) {
        return { stripeProductId: stripeProduct.id, stripePriceId };
      }
      // Deactivate the stale price; we'll make a new one below.
      if (existing.active) {
        await stripe.prices.update(stripePriceId, { active: false });
      }
    } catch {
      // Price was deleted in Stripe; just make a fresh one.
    }
  }
  const fresh = await stripe.prices.create({
    product: stripeProduct.id,
    unit_amount: p.priceCents,
    currency: "usd",
    metadata: { product_slug: p.slug },
  });
  return { stripeProductId: stripeProduct.id, stripePriceId: fresh.id };
}
