/** Marketing page content model — stored on `MarketingPageVersion.schema`. */

export const PAGE_SCHEMA_VERSION = 1 as const;

export type PageBlockType =
  | "hero"
  | "editorial_intro"
  | "feature_tiles"
  | "process_steps"
  | "testimonial"
  | "cta_split"
  | "rich_text"
  | "image"
  | "spacer"
  | "intake_form"
  | "products_grid";

export interface CtaLink {
  label: string;
  href: string;
}

interface Base {
  id: string;
  type: PageBlockType;
  anchor?: string;
}

export interface HeroBlock extends Base {
  type: "hero";
  imageUrl: string;
  imageAlt: string;
  eyebrow?: string;
  headline: string;
  headlineMuted?: string;
  body?: string;
  primaryCta?: CtaLink;
  secondaryCta?: CtaLink;
  /** Controls vertical size of the hero. */
  height?: "short" | "medium" | "tall";
}

export interface EditorialIntroBlock extends Base {
  type: "editorial_intro";
  quote: string;
  quoteMuted?: string;
  paragraphs: string[];
}

export interface FeatureTile {
  id: string;
  title: string;
  body: string;
  imageUrl: string;
  imageAlt: string;
}

export interface FeatureTilesBlock extends Base {
  type: "feature_tiles";
  eyebrow?: string;
  title: string;
  body?: string;
  tiles: FeatureTile[];
}

export interface ProcessStep {
  id: string;
  number: string;
  title: string;
  body: string;
}

export interface ProcessStepsBlock extends Base {
  type: "process_steps";
  eyebrow?: string;
  title: string;
  body?: string;
  steps: ProcessStep[];
}

export interface TestimonialBlock extends Base {
  type: "testimonial";
  quote: string;
  attribution?: string;
  sublabel?: string;
}

export interface CtaSplitBlock extends Base {
  type: "cta_split";
  eyebrow?: string;
  title: string;
  cta: CtaLink;
}

export interface RichTextBlock extends Base {
  type: "rich_text";
  paragraphs: string[];
  maxWidth?: "narrow" | "normal" | "wide";
}

export interface ImageBlock extends Base {
  type: "image";
  imageUrl: string;
  imageAlt: string;
  caption?: string;
  maxWidth?: "narrow" | "normal" | "full";
}

export interface SpacerBlock extends Base {
  type: "spacer";
  size: "small" | "medium" | "large";
}

/** Renders the currently-published version of an intake form by slug. */
export interface IntakeFormBlock extends Base {
  type: "intake_form";
  slug: string;
  eyebrow?: string;
  title?: string;
  body?: string;
}

/**
 * Live, buyable product cards from /admin/products. The renderer fetches
 * the current published product list and shows each as a card with price
 * + checkout CTA. `mode` controls the framing:
 *   "browse" — primary CTA "Get this plan", secondary "Send as a gift"
 *   "gift"   — primary CTA "Gift this plan", secondary "Or buy for myself"
 */
export interface ProductsGridBlock extends Base {
  type: "products_grid";
  mode?: "browse" | "gift";
  eyebrow?: string;
  title?: string;
  body?: string;
}

export type PageBlock =
  | HeroBlock
  | EditorialIntroBlock
  | FeatureTilesBlock
  | ProcessStepsBlock
  | TestimonialBlock
  | CtaSplitBlock
  | RichTextBlock
  | ImageBlock
  | SpacerBlock
  | IntakeFormBlock
  | ProductsGridBlock;

export interface PageSchema {
  version: typeof PAGE_SCHEMA_VERSION;
  blocks: PageBlock[];
}

const VALID_TYPES: ReadonlySet<string> = new Set<PageBlockType>([
  "hero",
  "editorial_intro",
  "feature_tiles",
  "process_steps",
  "testimonial",
  "cta_split",
  "rich_text",
  "image",
  "spacer",
  "intake_form",
  "products_grid",
]);

/**
 * Minimal structural validation — the admin UI authors this JSON, so we
 * protect against malformed submissions but don't hand-validate every field.
 * Missing text fields render as empty on the page, which is acceptable in
 * draft mode.
 */
export function parsePageSchema(raw: unknown): PageSchema | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== PAGE_SCHEMA_VERSION) return null;
  if (!Array.isArray(o.blocks)) return null;
  for (const b of o.blocks) {
    if (!b || typeof b !== "object") return null;
    const bo = b as Record<string, unknown>;
    if (typeof bo.id !== "string") return null;
    if (typeof bo.type !== "string" || !VALID_TYPES.has(bo.type)) return null;
  }
  return { version: PAGE_SCHEMA_VERSION, blocks: o.blocks as PageBlock[] };
}

function uid(prefix = "b"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Ships as the first version of `/` (slug: `home`). Content mirrors the
 * existing hardcoded homepage so visitors see no change on first deploy.
 */
export function defaultHomePageSchema(): PageSchema {
  return {
    version: PAGE_SCHEMA_VERSION,
    blocks: [
      {
        id: uid("hero"),
        type: "hero",
        imageUrl:
          "https://images.unsplash.com/photo-1511895426328-dc8714191300?auto=format&fit=crop&w=2000&q=80",
        imageAlt:
          "A parent and child walking together on a sunlit path by the water",
        eyebrow: "Boutique travel for families",
        headline: "The world, beautifully planned—",
        headlineMuted: "with little travelers in mind.",
        body: "Higher-end itineraries, calmer logistics, and room for wonder. We design trips that feel elevated for parents and magical for kids.",
        primaryCta: { label: "Start a conversation", href: "/connect" },
        secondaryCta: { label: "Our philosophy", href: "/#approach" },
        height: "tall",
      },
      {
        id: uid("intro"),
        type: "editorial_intro",
        anchor: "approach",
        quote: "Luxury, for us, is presence:",
        quoteMuted: "fewer tabs open, more sunsets shared.",
        paragraphs: [
          "Momentella is a travel studio for families who want depth without chaos—private drivers when jet lag hits, kid-friendly guides who actually like children, and hotels that understand early bedtimes.",
          "We borrow the editorial calm of a quiet magazine and the clarity of a well-run home: honest pacing, thoughtful defaults, and itineraries that leave space for ice cream stops and spontaneous detours.",
        ],
      },
      {
        id: uid("tiles"),
        type: "feature_tiles",
        anchor: "journeys",
        eyebrow: "Where we shine",
        title: "Journeys shaped around your crew",
        body: "Every trip is built from scratch—never a template. Here are a few rhythms families ask us for again and again.",
        tiles: [
          {
            id: uid("tile"),
            title: "Coast & islands",
            body: "Shallow water mornings, shaded afternoons, and dinners where strollers disappear discreetly.",
            imageUrl:
              "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
            imageAlt: "Calm turquoise shoreline from above",
          },
          {
            id: uid("tile"),
            title: "Cities made gentle",
            body: "Museums in small doses, secret gardens, and routes that respect little legs.",
            imageUrl:
              "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=1200&q=80",
            imageAlt: "Parisian architecture along a quiet street",
          },
          {
            id: uid("tile"),
            title: "Safari & nature",
            body: "Family-ready camps, age-appropriate drives, and guides who nurture curiosity safely.",
            imageUrl:
              "https://images.unsplash.com/photo-1516426122078-c23e76319801?auto=format&fit=crop&w=1200&q=80",
            imageAlt: "Golden savanna at sunset with acacia trees",
          },
          {
            id: uid("tile"),
            title: "Multi-gen gatherings",
            body: "Villas with room to spread out, shared meals that feel special, and logistics that honor every generation.",
            imageUrl:
              "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80",
            imageAlt:
              "Spacious modern villa with pool at golden hour, ideal for extended family stays",
          },
        ],
      },
      {
        id: uid("steps"),
        type: "process_steps",
        anchor: "process",
        eyebrow: "How we plan",
        title: "Calm, start to finish",
        body: "No dashboards to decode—just clear proposals, human check-ins, and planning that feels as considered as the trip itself.",
        steps: [
          {
            id: uid("step"),
            number: "01",
            title: "Listen deeply",
            body: "We start with how your family moves through a day—energy, nap windows, food quirks, and the memories you want more of.",
          },
          {
            id: uid("step"),
            number: "02",
            title: "Design the arc",
            body: "Routing, pacing, and backups that respect both ambition and reality. You’ll see the story of the trip before a single booking is made.",
          },
          {
            id: uid("step"),
            number: "03",
            title: "Handle the invisible",
            body: "Transfers, seats, early check-ins, trusted sitters, and on-trip support—so you’re never hunting confirmations in a lobby.",
          },
          {
            id: uid("step"),
            number: "04",
            title: "Stay close",
            body: "We remain a text away while you travel, ready to adjust when weather, moods, or magic demands a new plan.",
          },
        ],
      },
      {
        id: uid("testi"),
        type: "testimonial",
        quote:
          "We used to return from “vacation” needing another vacation. Momentella gave us spacious days, kid-level wonder, and the kind of hotels that remember your name—without ever feeling precious about having children along.",
        attribution: "— A Momentella family",
        sublabel: "Southern Europe & the islands",
      },
      {
        id: uid("cta"),
        type: "cta_split",
        eyebrow: "Follow along",
        title: "Daydreams, departures, and slow mornings abroad",
        cta: {
          label: "@momentella.travel",
          href: "https://www.instagram.com/momentella.travel/",
        },
      },
    ],
  };
}

/**
 * Seed content for the `/trip-booking` page — a richer pitch for our
 * full-service planning offering, capped with the same intake form as
 * `/connect`. Admin can replace any block in the page builder.
 */
export function defaultTripBookingPageSchema(
  formSlug = "family-trip",
): PageSchema {
  return {
    version: PAGE_SCHEMA_VERSION,
    blocks: [
      {
        id: uid("hero"),
        type: "hero",
        imageUrl:
          "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=2000&q=80",
        imageAlt: "A vintage suitcase on a quiet station platform at golden hour",
        eyebrow: "Full-service trip planning",
        headline: "We plan, book, and run—",
        headlineMuted: "the whole trip.",
        body: "Hotels, flights, transfers, guides, dinners, and on-trip support. Tell us where your family wants to go; we take care of the rest.",
        primaryCta: { label: "Start a conversation", href: "#trip-intake" },
        secondaryCta: { label: "How we plan", href: "#how-we-plan" },
        height: "tall",
      },
      {
        id: uid("intro"),
        type: "editorial_intro",
        quote: "Less logistics,",
        quoteMuted: "more presence.",
        paragraphs: [
          "Most family trips fall apart in the seams: a missed transfer, a hotel that didn't actually have a crib, a dinner reservation no one ever confirmed. We design around the seams.",
          "Momentella runs your trip end-to-end. You'll see the arc before a single booking is made, approve the pieces that matter, and step on the plane knowing the rest is handled. We're a text away the whole time.",
        ],
      },
      {
        id: uid("tiles"),
        type: "feature_tiles",
        eyebrow: "What's included",
        title: "Every layer of the trip, handled",
        body: "One studio, one designer, one point of contact—from the first dream all the way home.",
        tiles: [
          {
            id: uid("tile"),
            title: "Hotels & flights",
            body: "Vetted properties with real family rooms, sensible flights with seat selection sorted in advance, and check-ins timed to your kids—not a 3 PM standard.",
            imageUrl:
              "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
            imageAlt: "Soft-lit hotel suite with a window onto a quiet courtyard",
          },
          {
            id: uid("tile"),
            title: "Private guides & drivers",
            body: "Locally trusted guides who actually like children, and drivers who keep car seats, snacks, and small talk in the right balance.",
            imageUrl:
              "https://images.unsplash.com/photo-1500835556837-99ac94a94552?auto=format&fit=crop&w=1200&q=80",
            imageAlt: "A guided walk through a sunlit historic town",
          },
          {
            id: uid("tile"),
            title: "Logistics & transfers",
            body: "Airport meet-and-greet, train tickets, ferry timetables, lift passes, museum bookings, restaurant reservations—the unsexy work that makes a trip feel calm.",
            imageUrl:
              "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=80",
            imageAlt: "Boarding gate with a calm morning light through tall windows",
          },
          {
            id: uid("tile"),
            title: "On-trip support",
            body: "Storms, sick kids, a sudden craving for ice cream at 9 PM in a new city—we re-route, re-book, and recommend in real time, without losing the thread of the trip.",
            imageUrl:
              "https://images.unsplash.com/photo-1505761671935-60b3a7427bad?auto=format&fit=crop&w=1200&q=80",
            imageAlt: "Family walking together along a coastal promenade",
          },
        ],
      },
      {
        id: uid("steps"),
        type: "process_steps",
        anchor: "how-we-plan",
        eyebrow: "How we plan",
        title: "From first call to the last sunset",
        body: "A clear path, with you in the loop at the moments that matter—and quietly handled the rest of the time.",
        steps: [
          {
            id: uid("step"),
            number: "01",
            title: "Discover",
            body: "A 30-minute call to learn your family's rhythm—energy, food, naps, the kinds of memories you want more of, and the kinds of trips that haven't worked.",
          },
          {
            id: uid("step"),
            number: "02",
            title: "Design",
            body: "Within a few days you'll see a routed proposal: pacing, hotel choices, key experiences, with options where it matters. We refine until it feels right.",
          },
          {
            id: uid("step"),
            number: "03",
            title: "Book",
            body: "Once approved, we secure every reservation and lock down the logistics. You'll get a single, beautiful itinerary document—nothing to hunt for in your inbox.",
          },
          {
            id: uid("step"),
            number: "04",
            title: "Travel",
            body: "We're a text away the whole time. Weather pivots, mood shifts, missed flights—we adjust without you having to find a hotel desk in a strange airport.",
          },
        ],
      },
      {
        id: uid("testi"),
        type: "testimonial",
        quote:
          "We landed in a country we'd never been to with two tired kids, and our driver was already there with our names on a card and snacks in the backseat. From that moment until the goodbye text on day twelve, we never once had to figure something out ourselves.",
        attribution: "— A Momentella family",
        sublabel: "First full-service trip · Italy & the islands",
      },
      {
        id: uid("form"),
        type: "intake_form",
        anchor: "trip-intake",
        slug: formSlug,
        eyebrow: "Tell us about the trip",
        title: "Start with what you know",
        body: "Nothing here is set in stone. Share a sketch, a wish list, or a vague pull toward somewhere—we'll fill in the rest together.",
      },
    ],
  };
}

/**
 * Seed content for the `/gift-certificates` page. Conversion-focused:
 * the hero CTA scrolls straight to a real, buyable products grid in
 * gift mode (every card opens the checkout pre-toggled to "gift").
 * Marketing copy follows the products to reassure but doesn't gate the
 * primary action. Mother's Day eyebrow is admin-editable.
 */
export function defaultGiftCertificatesPageSchema(): PageSchema {
  return {
    version: PAGE_SCHEMA_VERSION,
    blocks: [
      {
        id: uid("hero"),
        type: "hero",
        imageUrl:
          "https://images.unsplash.com/photo-1495121605193-b116b5b9c5fe?auto=format&fit=crop&w=2000&q=80",
        imageAlt:
          "Soft morning light over an open journal, fresh flowers, and a coffee cup",
        eyebrow: "A Mother's Day gift she'll actually use",
        headline: "Skip the candles—",
        headlineMuted: "give her a vacation day, designed.",
        body: "Pick a 1, 2, or 3-day itinerary plan below. We'll email her a beautifully presented redemption link, and her dedicated trip designer takes it from there.",
        primaryCta: { label: "Choose her gift ↓", href: "#gift-plans" },
        secondaryCta: { label: "How gifting works", href: "#how-it-works" },
        height: "tall",
      },
      {
        id: uid("plans"),
        type: "products_grid",
        anchor: "gift-plans",
        mode: "gift",
        eyebrow: "Choose her plan",
        title: "Three ways to gift a perfect day",
        body: "Every plan is built from scratch by a real travel designer—not a template, not an algorithm. She redeems when she's ready.",
      },
      {
        id: uid("intro"),
        type: "editorial_intro",
        quote: "Skip the spa basket.",
        quoteMuted: "Give her a vacation day she'll actually relax through.",
        paragraphs: [
          "Mom doesn't need another mug. She needs the day in Lisbon she's been Pinterest-ing for three years, mapped out by someone who understands the difference between a perfect afternoon and a tourist's afternoon.",
          "Pick a plan above. Add a personal note at checkout. We'll send her a thoughtful gift email and her own private trip page. She doesn't have to do a thing until she's ready to start dreaming.",
        ],
      },
      {
        id: uid("steps"),
        type: "process_steps",
        anchor: "how-it-works",
        eyebrow: "How gifting works",
        title: "Four steps. Five minutes.",
        body: "Order today and she'll have her gift in her inbox within minutes.",
        steps: [
          {
            id: uid("step"),
            number: "01",
            title: "Pick a plan",
            body: "1, 2, or 3 days—based on whether she wants a perfect afternoon, a long weekend, or half a vacation handled.",
          },
          {
            id: uid("step"),
            number: "02",
            title: "Write her a note",
            body: "A few lines from you, included in her gift email. We frame it beautifully—no awkward generic template language.",
          },
          {
            id: uid("step"),
            number: "03",
            title: "We send the gift",
            body: "She gets a Momentella-branded email with your note, the plan she's been gifted, and a one-tap link to redeem when she's ready.",
          },
          {
            id: uid("step"),
            number: "04",
            title: "Her designer takes over",
            body: "When she redeems, her own trip page comes to life and her designer reaches out to start the conversation. You get a note from us when she's used it.",
          },
        ],
      },
      {
        id: uid("testi"),
        type: "testimonial",
        quote:
          "I gave my mom the 2-day plan for her London trip. She told me she finally felt like someone took the planning weight off her shoulders—she just got to be there.",
        attribution: "— A Momentella gift-giver",
        sublabel: "Gift recipient · London · 2-day plan",
      },
      {
        id: uid("cta"),
        type: "cta_split",
        eyebrow: "Still scrolling?",
        title: "Three plans. One gift she'll actually unwrap twice.",
        cta: { label: "Choose her plan ↑", href: "#gift-plans" },
      },
    ],
  };
}

/**
 * Seed content for the `/connect` page. Embeds the intake form keyed by slug
 * (defaults to `family-trip` — the admin can switch forms in the page builder).
 */
export function defaultConnectPageSchema(
  formSlug = "family-trip",
): PageSchema {
  return {
    version: PAGE_SCHEMA_VERSION,
    blocks: [
      {
        id: uid("hero"),
        type: "hero",
        imageUrl:
          "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=2000&q=80",
        imageAlt: "Family looking at a travel map together",
        eyebrow: "Let’s plan your trip",
        headline: "Tell us about your family—",
        headlineMuted: "and the trip you have in mind.",
        body: "We’ll respond within a business day with next steps and a call invite if it’s a fit.",
        height: "short",
      },
      {
        id: uid("form"),
        type: "intake_form",
        slug: formSlug,
        eyebrow: "Trip intake",
        title: "A few details to get started",
        body: "Nothing here is set in stone. Share what you know and we’ll fill in the rest together.",
      },
    ],
  };
}
