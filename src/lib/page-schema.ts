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
  | "intake_form";

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
  | IntakeFormBlock;

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
