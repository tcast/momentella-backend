/**
 * Niche / SEO landing pages — one per travel sub-segment we serve. Each
 * page is fully editable via the admin page builder; this file just
 * provides the seed content. Designed for paid-traffic landing and
 * organic SEO — every page has a distinct H1, hero image, and copy
 * tuned to its segment, then funnels into the same intake form as
 * `/connect`.
 */

import {
  PAGE_SCHEMA_VERSION,
  type PageSchema,
} from "./page-schema.js";

function uid(prefix = "b"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface NicheTile {
  title: string;
  body: string;
  imageUrl: string;
  imageAlt: string;
}

export interface NicheStep {
  number: string;
  title: string;
  body: string;
}

export interface NicheConfig {
  slug: string;
  name: string;
  description: string;
  /** SEO title (under ~60 chars) and meta description (~155). */
  metaTitle: string;
  metaDescription: string;

  heroEyebrow: string;
  heroImageUrl: string;
  heroImageAlt: string;
  heroHeadline: string;
  heroHeadlineMuted: string;
  heroBody: string;

  introQuote: string;
  introQuoteMuted: string;
  introParagraphs: string[];

  tilesEyebrow: string;
  tilesTitle: string;
  tilesBody: string;
  tiles: NicheTile[];

  stepsEyebrow: string;
  stepsTitle: string;
  stepsBody: string;
  steps: NicheStep[];

  testimonialQuote: string;
  testimonialAttribution: string;
  testimonialSublabel: string;

  /** Intake form to embed at the bottom. Defaults to the family-trip form. */
  formSlug?: string;
}

/**
 * Templated niche page schema. Produces hero → editorial intro →
 * feature tiles → process steps → testimonial → intake form.
 */
export function nichePageSchema(c: NicheConfig): PageSchema {
  return {
    version: PAGE_SCHEMA_VERSION,
    blocks: [
      {
        id: uid("hero"),
        type: "hero",
        imageUrl: c.heroImageUrl,
        imageAlt: c.heroImageAlt,
        eyebrow: c.heroEyebrow,
        headline: c.heroHeadline,
        headlineMuted: c.heroHeadlineMuted,
        body: c.heroBody,
        primaryCta: { label: "Start a conversation", href: "#trip-intake" },
        secondaryCta: { label: "How we plan", href: "#how-we-plan" },
        height: "tall",
      },
      {
        id: uid("intro"),
        type: "editorial_intro",
        quote: c.introQuote,
        quoteMuted: c.introQuoteMuted,
        paragraphs: c.introParagraphs,
      },
      {
        id: uid("tiles"),
        type: "feature_tiles",
        eyebrow: c.tilesEyebrow,
        title: c.tilesTitle,
        body: c.tilesBody,
        tiles: c.tiles.map((t) => ({ id: uid("tile"), ...t })),
      },
      {
        id: uid("steps"),
        type: "process_steps",
        anchor: "how-we-plan",
        eyebrow: c.stepsEyebrow,
        title: c.stepsTitle,
        body: c.stepsBody,
        steps: c.steps.map((s) => ({ id: uid("step"), ...s })),
      },
      {
        id: uid("testi"),
        type: "testimonial",
        quote: c.testimonialQuote,
        attribution: c.testimonialAttribution,
        sublabel: c.testimonialSublabel,
      },
      {
        id: uid("form"),
        type: "intake_form",
        anchor: "trip-intake",
        slug: c.formSlug ?? "family-trip",
        eyebrow: "Tell us about the trip",
        title: "Start with what you know",
        body: "Nothing here is set in stone. Share a sketch, a wish list, or a vague pull toward somewhere — we'll fill in the rest together.",
      },
    ],
  };
}

/* ───────────────────────────────────────────────────────────────────────
   The eight niche configs. Each is a complete page that can stand alone
   as a paid-ads landing page and rank on its own SEO terms.
   ─────────────────────────────────────────────────────────────────────── */

export const NICHE_PAGES: NicheConfig[] = [
  {
    slug: "family-vacations",
    name: "Family vacations",
    description: "Family vacation planning landing page",
    metaTitle: "Family Vacation Planning · Momentella",
    metaDescription:
      "Boutique family vacation planning — itineraries with calmer logistics, kid-friendly hotels, and pacing built around real children. Higher-end travel for families.",
    heroEyebrow: "Family vacations",
    heroImageUrl:
      "https://images.unsplash.com/photo-1502920917128-1aa500764cbd?auto=format&fit=crop&w=2000&q=80",
    heroImageAlt: "Family walking together along a quiet coastal path at golden hour",
    heroHeadline: "Family vacations,",
    heroHeadlineMuted: "designed around real children.",
    heroBody:
      "Hotels with rooms big enough for cribs. Guides who actually like kids. Itineraries that respect nap windows, picky palates, and the magic of an unplanned afternoon. We plan the family trip you've been imagining — the one that doesn't end with everyone needing a vacation from the vacation.",
    introQuote: "A family trip should feel like a family,",
    introQuoteMuted: "not a logistics exercise.",
    introParagraphs: [
      "We plan family vacations end-to-end. The hotel that has actual cribs — not a pack-and-play stuffed in a closet. The driver who keeps snacks in the back seat. The dinner reservation that's somehow accommodating to a four-year-old AND a teenager.",
      "You'll see the arc of the trip before a single booking is made. We design pacing around your kids' rhythm, not a tour-bus schedule. And we're a text away the entire time you're traveling.",
    ],
    tilesEyebrow: "What we handle",
    tilesTitle: "Every layer of a family trip",
    tilesBody:
      "Hotels, flights, transfers, guides, dinners, and on-trip support — all designed for traveling with kids. So you can be present instead of project-managing.",
    tiles: [
      {
        title: "Family-ready hotels",
        body: "Connecting rooms or proper suites with cribs. Not the fold-out kind — the actual kind. Pools that close at a sensible hour, breakfasts that have something for picky eaters, staff that knows your kids' names by day two.",
        imageUrl:
          "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Family suite with crib and quiet morning light",
      },
      {
        title: "Pacing that fits",
        body: "Big experience in the morning, downtime in the afternoon, dinner before meltdown hour. We plan the day around your children's actual energy — not what looks good on Instagram.",
        imageUrl:
          "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Calm beach morning with shaded lounge chairs",
      },
      {
        title: "Guides kids love",
        body: "Locally vetted guides who genuinely enjoy children — and know how to make a museum, a market, or a hike feel like an adventure to a six-year-old without dumbing it down for the adults.",
        imageUrl:
          "https://images.unsplash.com/photo-1500835556837-99ac94a94552?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Family on a guided walking tour through an old city",
      },
      {
        title: "On-trip support",
        body: "Storms, sick kids, a sudden 9pm need for ice cream — we re-route, re-book, and recommend in real time. You text us; we handle it. No phone trees, no hunting for a hotel desk in a strange airport.",
        imageUrl:
          "https://images.unsplash.com/photo-1505761671935-60b3a7427bad?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Family walking together on a coastal promenade",
      },
    ],
    stepsEyebrow: "How we plan",
    stepsTitle: "From first call to last sunset",
    stepsBody:
      "A clear path with you in the loop at the moments that matter — and quietly handled the rest of the time.",
    steps: [
      {
        number: "01",
        title: "Discover",
        body: "A 30-minute call to learn your family's rhythm — energy, food, naps, the kinds of memories you want more of, and what hasn't worked.",
      },
      {
        number: "02",
        title: "Design",
        body: "Within a few days you'll see a routed proposal: pacing, hotel choices, key experiences, with options where it matters. We refine until it feels right.",
      },
      {
        number: "03",
        title: "Book",
        body: "Once approved, we secure every reservation. You'll get a single, beautiful itinerary document — nothing to hunt for in your inbox.",
      },
      {
        number: "04",
        title: "Travel",
        body: "We're a text away the entire trip. Weather pivots, mood shifts, missed flights — we adjust without you having to find a hotel desk in a strange airport.",
      },
    ],
    testimonialQuote:
      "We landed in a country we'd never been to with two tired kids, and our driver was already there with our names on a card and snacks in the backseat. From that moment until the goodbye text on day twelve, we never once had to figure something out ourselves.",
    testimonialAttribution: "— A Momentella family",
    testimonialSublabel: "First family trip · Italy & the islands",
  },

  // family-vacations keeps the existing family-trip form (already family-tuned).
  {
    slug: "multigenerational-trips",
    name: "Multigenerational trips",
    formSlug: "multigenerational-intake",
    description: "Multigenerational and family reunion travel landing page",
    metaTitle: "Multigenerational Trip Planning · Momentella",
    metaDescription:
      "Travel with three generations under one roof. Villas, daily logistics, and pacing that respects grandparents, parents, and kids alike. Boutique multigen planning.",
    heroEyebrow: "Multigenerational travel",
    heroImageUrl:
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=2000&q=80",
    heroImageAlt: "Spacious villa terrace at golden hour, ideal for extended family stays",
    heroHeadline: "Three generations,",
    heroHeadlineMuted: "one beautifully run trip.",
    heroBody:
      "Grandparents, parents, kids — different needs, different paces, all on one trip. We design multigen vacations that give each generation room to be themselves: shared meals when it matters, separate adventures when it doesn't, and logistics that don't quietly ruin the whole thing.",
    introQuote: "The hardest part of a family-reunion trip",
    introQuoteMuted: "isn't the trip. It's making everyone happy.",
    introParagraphs: [
      "Three generations under one roof can be the trip of a lifetime — or a planning nightmare with a Google Doc that nobody actually reads. We've designed this for the former.",
      "Villas with room to spread out (and pull back together for dinner). Activities split across age groups but anchored by shared moments. Logistics handled so the grandparents aren't carrying suitcases up four flights, the kids have what they need at every meal, and the parents — who usually plan all of this — finally just get to be on vacation.",
    ],
    tilesEyebrow: "What we plan for",
    tilesTitle: "A trip that works for everyone",
    tilesBody:
      "We've planned enough multigen trips to know where they fall apart. Here's what we build in.",
    tiles: [
      {
        title: "The right villa",
        body: "Bedrooms with their own bathrooms — non-negotiable. Common spaces big enough for the loud cousins and quiet enough for the early-rising grandparents. Kitchens that can host one big breakfast or three small ones.",
        imageUrl:
          "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Spacious villa with multiple living areas at sunset",
      },
      {
        title: "Split-track days",
        body: "Active hike for the parents, gentle market stroll for the grandparents, kids' adventure with a guide — all converging back at the villa for one shared dinner. Built into the daily plan, not improvised at breakfast.",
        imageUrl:
          "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Family looking at a travel map together",
      },
      {
        title: "Mobility-aware logistics",
        body: "Vehicles that fit everyone (with strollers and walkers). Hotels and villas without a hike up to the entrance. Restaurants we've vetted for noise level and accessibility — the kind of thing nobody mentions but everyone notices.",
        imageUrl:
          "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Calm boarding gate in soft morning light",
      },
      {
        title: "One shared moment per day",
        body: "A long lunch, a shared sunset, a drive together to a single thing — the meal or memory the grandparents will remember and the kids will tell their own kids about. We make sure that moment exists, every day.",
        imageUrl:
          "https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Long table set for a family dinner at sunset",
      },
    ],
    stepsEyebrow: "How it works",
    stepsTitle: "Multigen trips, organized",
    stepsBody:
      "We start with a single point of contact (usually one parent or a designated ringleader), then build out a plan everyone agrees with before booking anything.",
    steps: [
      {
        number: "01",
        title: "Listen to all generations",
        body: "We talk with you about what each generation actually wants — and gently calibrate when expectations don't quite line up. (They never quite do.)",
      },
      {
        number: "02",
        title: "Design split-track",
        body: "A daily arc with shared anchor moments and parallel tracks for different generations. Enough structure that nothing collapses, enough flex that no one feels pinned down.",
      },
      {
        number: "03",
        title: "Book + brief",
        body: "We confirm every reservation and prepare a single shared itinerary that's actually readable. Each generation knows what their day looks like without sifting through emails.",
      },
      {
        number: "04",
        title: "Stay close on trip",
        body: "Nine people, twelve days, lots of moving parts. We're a text away to re-route, re-book, or reassure — usually before anyone notices a problem.",
      },
    ],
    testimonialQuote:
      "Three generations, twelve people, one villa in Tuscany. I had been dreading the planning for months. Momentella took it over and we just — went. My mother-in-law still talks about the night they brought a chef in for the kids' birthday. I haven't even told her how that came together.",
    testimonialAttribution: "— A Momentella matriarch",
    testimonialSublabel: "Multigen reunion · Tuscany · 12 days",
  },

  {
    slug: "couples-trips",
    name: "Couples trips",
    formSlug: "couples-intake",
    description: "Romantic couples travel and weekend getaways",
    metaTitle: "Couples Trips & Romantic Getaways · Momentella",
    metaDescription:
      "Boutique trip planning for couples — long weekends, anniversaries, just-because escapes. Hotels with character, dinners worth the flight, logistics handled.",
    heroEyebrow: "Couples trips",
    heroImageUrl:
      "https://images.unsplash.com/photo-1530229540764-5f6ab595fe43?auto=format&fit=crop&w=2000&q=80",
    heroImageAlt: "A couple at a quiet rooftop terrace at golden hour",
    heroHeadline: "A trip that feels like just the two of you,",
    heroHeadlineMuted: "even when the rest of life doesn't.",
    heroBody:
      "Long weekends. Anniversaries. Just-because escapes. We plan couples trips with hotels that have character, dinners worth flying for, and the kind of pacing that lets you actually be together — not whatever your last shared Google Doc was.",
    introQuote: "Romance is mostly logistics",
    introQuoteMuted: "you don't have to think about.",
    introParagraphs: [
      "It's not the rose petals on the bed (please, no). It's the driver who knows where you're going so neither of you has to navigate. The hotel that remembers your anniversary without you mentioning it. The dinner where the table happens to face the sunset.",
      "We plan all of that. You just show up and remember why you like each other.",
    ],
    tilesEyebrow: "What we curate",
    tilesTitle: "Designed for the two of you",
    tilesBody:
      "Hotels, dinners, and experiences chosen for couples — not for groups, families, or solo travelers.",
    tiles: [
      {
        title: "Hotels with character",
        body: "Properties where the design tells you something about the place — not chain hotels with city names taped on. Rooms with views, baths with depth, breakfasts where you don't have to talk to anyone if you don't want to.",
        imageUrl:
          "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Boutique hotel suite with balcony",
      },
      {
        title: "Dinners that are the trip",
        body: "We book the restaurants people fly for — and the small ones that aren't on any list yet but should be. The right table, the right time, occasionally a quiet word with the chef.",
        imageUrl:
          "https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Romantic restaurant terrace at sunset",
      },
      {
        title: "Half-day rhythms",
        body: "One thing in the morning, one thing in the late afternoon, room for a long lunch and a longer nap. The pacing of a great couples trip is half the magic.",
        imageUrl:
          "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Quiet morning view of a city from a hotel terrace",
      },
      {
        title: "The unspoken extras",
        body: "Champagne already chilled. Driver waiting at the airport without a sign because he already knows what you look like. The reservation moved up an hour because we knew you'd be early. Small things, big difference.",
        imageUrl:
          "https://images.unsplash.com/photo-1504593811423-6dd665756598?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Champagne and two glasses on a hotel balcony",
      },
    ],
    stepsEyebrow: "How we plan",
    stepsTitle: "Less planning, more presence",
    stepsBody: "From first sketch to last sunset.",
    steps: [
      {
        number: "01",
        title: "Tell us the feel",
        body: "Beach or city? Quiet or buzz? The trip you took five years ago that you keep talking about? We start there.",
      },
      {
        number: "02",
        title: "Design two options",
        body: "We'll send you two routed proposals — different vibes, similar budget. You pick the one that lands. We refine.",
      },
      {
        number: "03",
        title: "Book everything",
        body: "Hotels, flights, dinners, transfers. One itinerary document. No spreadsheets. No frantic restaurant emails the week before.",
      },
      {
        number: "04",
        title: "Be on the trip",
        body: "We're a text away if anything needs adjusting. You're free to actually be on vacation — together.",
      },
    ],
    testimonialQuote:
      "We hadn't traveled just the two of us in nine years. Momentella planned a long weekend in Lisbon that felt like we were dating again. The taxi from the airport had a bottle of vinho verde in the back seat. Who does that?",
    testimonialAttribution: "— A Momentella couple",
    testimonialSublabel: "Anniversary weekend · Lisbon",
  },

  {
    slug: "honeymoons",
    name: "Honeymoons",
    formSlug: "honeymoon-intake",
    description: "Honeymoon trip planning",
    metaTitle: "Honeymoon Planning · Momentella",
    metaDescription:
      "Your honeymoon, designed by people who've planned hundreds of them. Hotels, dinners, and pacing chosen for newlyweds. We handle everything; you arrive and breathe.",
    heroEyebrow: "Honeymoons",
    heroImageUrl:
      "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=2000&q=80",
    heroImageAlt: "A romantic destination with golden hour light",
    heroHeadline: "Your honeymoon,",
    heroHeadlineMuted: "designed before the wedding ends.",
    heroBody:
      "By the time the last guest leaves, you're tired. Of decisions, of seating charts, of choosing things. Your honeymoon shouldn't be more of that. We design it end-to-end so you arrive, breathe, and remember why you did all of that in the first place.",
    introQuote: "A honeymoon is the first vacation you take",
    introQuoteMuted: "as the people you just became.",
    introParagraphs: [
      "It deserves more thought than 'Bali because someone we know went there.' We design honeymoons around what you actually love — not what's trending — and we handle the planning load so you don't add 'plan honeymoon' to a wedding-planning checklist that's already too long.",
      "Hotels we've vetted personally. Dinners that aren't tourist traps. The kind of small thoughtful upgrades that make a hotel staff smile when you walk in. You just show up.",
    ],
    tilesEyebrow: "What's included",
    tilesTitle: "A honeymoon, fully run",
    tilesBody: "Every detail planned, booked, and on a single itinerary you can ignore until it's time to leave.",
    tiles: [
      {
        title: "Hotels that know it's a honeymoon",
        body: "Properties where the welcome is warmer because you're newlyweds — without it being weird. Upgrades when possible. The right room, not just any room with a sea view.",
        imageUrl:
          "https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Honeymoon suite with ocean view",
      },
      {
        title: "Built for two",
        body: "Activities that are couple-paced — long breakfasts, leisurely starts, sunset something every day. None of the relentless tour-group rhythm.",
        imageUrl:
          "https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Couple at a sunset dinner overlooking the sea",
      },
      {
        title: "Multi-stop logistics",
        body: "City + beach. Two islands. Old city + countryside. Honeymoons often want a contrast — we route the transitions so the second half feels like a reset, not a slog.",
        imageUrl:
          "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Mountain and water landscape at sunrise",
      },
      {
        title: "Quiet thoughtful extras",
        body: "Champagne already in the room. The dinner reservation that happens to be your wedding date. A note from us when you land. Small things, the kind that make a honeymoon stop feeling generic.",
        imageUrl:
          "https://images.unsplash.com/photo-1504593811423-6dd665756598?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Champagne and two glasses on a balcony",
      },
    ],
    stepsEyebrow: "How we plan",
    stepsTitle: "Designed during the engagement, run on the honeymoon",
    stepsBody: "Most couples come to us 4–9 months out. The earlier the better for hotel availability, but we've built lovely trips on shorter timelines too.",
    steps: [
      {
        number: "01",
        title: "Discover",
        body: "A call to learn what you love (and don't), what you've already done, and what kind of pacing actually works for you as a couple.",
      },
      {
        number: "02",
        title: "Design",
        body: "We send you two routed proposals — different feels, similar budget. You pick the one that lands; we refine.",
      },
      {
        number: "03",
        title: "Book",
        body: "Every reservation locked. One beautiful itinerary document arrives in your inbox a few weeks before you fly. Read it on the plane if you want.",
      },
      {
        number: "04",
        title: "Travel",
        body: "We're a text away the whole time. You're free to do the thing honeymoons are for: be a newlywed.",
      },
    ],
    testimonialQuote:
      "By the wedding I was so done with planning anything that I'd half-decided we'd just do a hotel and figure it out. Tony's wife — Adrienne — convinced me to let Momentella plan our honeymoon. We arrived in Italy completely empty-handed. They had everything. Best two weeks of our lives.",
    testimonialAttribution: "— A Momentella honeymooner",
    testimonialSublabel: "Italy · 14 days · Spring honeymoon",
  },

  {
    slug: "babymoons",
    name: "Babymoons",
    formSlug: "babymoon-intake",
    description: "Babymoon trip planning for expecting couples",
    metaTitle: "Babymoon Planning · Momentella",
    metaDescription:
      "A last calm trip before the baby — designed for expecting couples. Hotels with proper bathtubs, easy logistics, and pacing built around how a pregnancy actually feels.",
    heroEyebrow: "Babymoons",
    heroImageUrl:
      "https://images.unsplash.com/photo-1495121605193-b116b5b9c5fe?auto=format&fit=crop&w=2000&q=80",
    heroImageAlt: "Soft morning light with flowers and a journal — quiet calm",
    heroHeadline: "One last calm trip,",
    heroHeadlineMuted: "before everything changes.",
    heroBody:
      "A babymoon isn't quite a honeymoon and isn't quite a regular vacation. We plan it specifically — easy travel times, hotels with proper bathtubs, restaurants that aren't going to make you feel sick, pacing built around how a pregnancy actually feels at 28 weeks.",
    introQuote: "The next time you take a trip just the two of you",
    introQuoteMuted: "won't feel like this.",
    introParagraphs: [
      "We plan babymoons that are calm by design. Direct flights. Hotels close to medical care if it ever matters (it usually doesn't, but it should be there). Beds that aren't a wreck on your back. Food you can actually eat. Activities that are gentle enough not to ruin you.",
      "And we don't make a thing of it. The hotel just has the right pillow already in the room. The restaurant just doesn't seat you next to the kitchen. Quiet, considered, no fuss.",
    ],
    tilesEyebrow: "What we think about",
    tilesTitle: "Pregnancy-aware planning",
    tilesBody: "The things you don't want to be Googling at 11pm.",
    tiles: [
      {
        title: "Easy travel days",
        body: "Direct flights when possible. Travel times that don't have you in the air on a difficult day. Comfortable cars to and from airports — no last-minute Ubers.",
        imageUrl:
          "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Calm departures gate in soft morning light",
      },
      {
        title: "Pregnancy-friendly hotels",
        body: "Real bathtubs, quality mattresses, rooms not above the bar. Within reasonable distance of medical care. We've vetted them — most properties haven't thought about a single one of these things.",
        imageUrl:
          "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Calm hotel suite with proper bathtub",
      },
      {
        title: "Food you can eat",
        body: "Restaurants chosen with pregnancy in mind — nothing aggressively raw, plenty of options, kitchens that take dietary requests seriously. We brief them ahead so you don't have to explain at the table.",
        imageUrl:
          "https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Quiet restaurant table with thoughtful place settings",
      },
      {
        title: "Gentle pacing",
        body: "One activity per day, max. Long mornings. Naps protected. Dinners early enough that you actually want them. The opposite of a tour-bus week.",
        imageUrl:
          "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Soft morning city view from a hotel terrace",
      },
    ],
    stepsEyebrow: "How we plan",
    stepsTitle: "Quiet, considered, fast",
    stepsBody:
      "Most couples come to us in their second trimester. We can plan a great babymoon in 2–6 weeks if needed — earlier is better but we're used to short timelines.",
    steps: [
      {
        number: "01",
        title: "Discover",
        body: "A short call to understand how the pregnancy is going, what you can/can't eat or drink, and what kind of trip actually sounds good — beach, city, somewhere quiet.",
      },
      {
        number: "02",
        title: "Design",
        body: "We send you a single routed proposal (couples in second trimester usually don't want a decision tree). Refine until it feels right.",
      },
      {
        number: "03",
        title: "Book",
        body: "Every reservation handled. One readable itinerary. Notes for the hotels about everything we discussed.",
      },
      {
        number: "04",
        title: "Travel",
        body: "We're a text away — and we'll quietly check in once or twice during the trip. You're free to nap.",
      },
    ],
    testimonialQuote:
      "I was 30 weeks pregnant and had assumed our 'babymoon' would just be a hotel weekend in the same city. Adrienne planned us five days in Sonoma. Direct flight, beautiful inn with the right bed, restaurants that already knew about my food restrictions. I cried twice. (Pregnancy hormones, but still.)",
    testimonialAttribution: "— A Momentella expecting parent",
    testimonialSublabel: "Babymoon · Sonoma · 5 days",
  },

  {
    slug: "destination-weddings",
    name: "Destination weddings",
    formSlug: "destination-wedding-intake",
    description: "Destination wedding planning",
    metaTitle: "Destination Wedding Planning · Momentella",
    metaDescription:
      "Boutique destination wedding planning — venue, logistics, guest experience, and the rehearsal-dinner-to-Sunday-brunch arc. We design a weekend, not just a wedding.",
    heroEyebrow: "Destination weddings",
    heroImageUrl:
      "https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=2000&q=80",
    heroImageAlt: "An elegant outdoor wedding setup at golden hour",
    heroHeadline: "Your destination wedding,",
    heroHeadlineMuted: "designed as a weekend, not a ceremony.",
    heroBody:
      "Most destination weddings are a great Saturday surrounded by chaos. We design the whole arc — welcome night, the day itself, brunch — and the logistics that turn 60 people in a foreign country into something that feels effortless. Including yours, the morning after.",
    introQuote: "A destination wedding isn't an event,",
    introQuoteMuted: "it's a long weekend with everyone you love.",
    introParagraphs: [
      "We treat it that way. The ceremony and reception are obviously the centerpiece — but what makes destination weddings memorable is the welcome dinner the night before, the morning hike on the big day, the late lunch after the brunch when everyone's still there in their pajamas not wanting to leave yet.",
      "We plan the weekend. We coordinate with your venue and any wedding planner you already have, or we run the whole thing. Either way, we handle the guest-experience layer — transfers, group activities, restaurant blocks, welcome bags — that makes a destination wedding feel like a gift to your people.",
    ],
    tilesEyebrow: "What we plan",
    tilesTitle: "The weekend around the wedding",
    tilesBody:
      "Whether or not you have a wedding planner for the day-of, we design the rest of the arc.",
    tiles: [
      {
        title: "Welcome dinner",
        body: "Long-table dinner the night before — at a venue we've vetted, with food you'd choose for a special meal even without a wedding context. The first thing your guests experience after travel.",
        imageUrl:
          "https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Long table set for a welcome dinner at sunset",
      },
      {
        title: "Guest logistics",
        body: "Transfers, hotel blocks, welcome bags, and the unsexy work — visa reminders, daypack-friendly maps, a number to call if a flight gets diverted. So your aunt isn't texting you the night before the wedding.",
        imageUrl:
          "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Calm boarding gate with morning light",
      },
      {
        title: "Stay-and-play days",
        body: "Curated activities for guests who arrive early or stay late: a private boat day, a vineyard lunch, a guided walk through the old city. Optional, signed up for in advance — so it's not chaos.",
        imageUrl:
          "https://images.unsplash.com/photo-1500835556837-99ac94a94552?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Group of friends on a guided coastal walk",
      },
      {
        title: "Sunday brunch",
        body: "The post-wedding brunch is the moment people remember. We design one that's easy, beautiful, and where you can actually sit and have a coffee with someone who flew in for you.",
        imageUrl:
          "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "A relaxed Sunday brunch table with coffee and pastries",
      },
    ],
    stepsEyebrow: "How we work",
    stepsTitle: "Coordinated with you and any other planner",
    stepsBody:
      "We don't replace your day-of wedding planner. We complement them by designing the surrounding weekend — and we coordinate with venues directly so nothing falls between teams.",
    steps: [
      {
        number: "01",
        title: "Discover",
        body: "We meet (virtually) with you both, learn your venue + wedding planner setup if any, and understand who's coming.",
      },
      {
        number: "02",
        title: "Design the arc",
        body: "Welcome dinner → activities → ceremony day support → brunch. Each piece designed and routed.",
      },
      {
        number: "03",
        title: "Book + brief",
        body: "We secure venues, restaurants, transfers, and group activities. We brief your guests with one clean welcome packet.",
      },
      {
        number: "04",
        title: "Run the weekend",
        body: "We're on the ground (or a text away) the whole weekend, handling guest issues so they never become your issues.",
      },
    ],
    testimonialQuote:
      "Our wedding planner did the day-of beautifully. Momentella did everything else: the welcome dinner, the boat day for our college friends, the brunch. People keep saying 'best wedding weekend we've ever been to' — and what they mean is the four days, not the four hours.",
    testimonialAttribution: "— A Momentella wedding couple",
    testimonialSublabel: "Wedding weekend · Croatia · 4 days",
  },

  {
    slug: "anniversary-trips",
    name: "Anniversary trips",
    formSlug: "anniversary-intake",
    description: "Anniversary milestone trip planning",
    metaTitle: "Anniversary Trip Planning · Momentella",
    metaDescription:
      "Milestone anniversary trips designed for couples who have been somewhere together before. Hotels, dinners, and pacing that match where you are now — not where you started.",
    heroEyebrow: "Anniversary trips",
    heroImageUrl:
      "https://images.unsplash.com/photo-1471919743851-c4df8b6ee133?auto=format&fit=crop&w=2000&q=80",
    heroImageAlt: "Two glasses on a sunset terrace at golden hour",
    heroHeadline: "Anniversary trips,",
    heroHeadlineMuted: "for couples who already know what they like.",
    heroBody:
      "Tenth, twenty-fifth, thirty-fifth — the trips that mark where you've been. We plan anniversary travel for couples who don't need pamphlets and 'top 10' lists. Hotels you'll actually love. Dinners worth flying for. Pacing built around who you are now.",
    introQuote: "By the tenth one,",
    introQuoteMuted: "you know what a vacation should feel like.",
    introParagraphs: [
      "You don't need a slideshow of options. You need someone who listens once, gets it, and books the right thing. We're that someone.",
      "Most of our anniversary couples are repeat clients — once we know what you like, the next trip takes a phone call. Hotels that fit your taste. Restaurants you'd actually return to. Trips that feel like a continuation, not a reinvention.",
    ],
    tilesEyebrow: "What we curate",
    tilesTitle: "Built around what you've already loved",
    tilesBody:
      "Anniversary travel works best when the planner is paying attention to the threads from your other trips. We're built for that.",
    tiles: [
      {
        title: "Hotels you'll keep",
        body: "We choose hotels you'll happily come back to — not the trendy thing for the year. The kind of properties that earn second visits.",
        imageUrl:
          "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Quiet hotel suite with morning light",
      },
      {
        title: "Restaurants worth flying for",
        body: "We book the dinners that justify the trip. The kind of meal you'll talk about a year later — and we know which night to put it on so it doesn't get lost in the rotation.",
        imageUrl:
          "https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Sunset dinner terrace overlooking water",
      },
      {
        title: "Quiet milestones",
        body: "If you want to mark the day, we mark it — but never tackily. A small upgrade. The right wine sent to the table. A note from the property's owner. We know how to do this without making a thing of it.",
        imageUrl:
          "https://images.unsplash.com/photo-1504593811423-6dd665756598?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Champagne and two glasses on a hotel balcony",
      },
      {
        title: "Repeat-ready",
        body: "We keep notes. The next trip is faster — one call, you tell us the season and the budget, and we build something you'll love. The third trip takes ten minutes.",
        imageUrl:
          "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Mountain landscape at sunrise",
      },
    ],
    stepsEyebrow: "How we plan",
    stepsTitle: "Less back-and-forth, more confidence",
    stepsBody:
      "We start with one good listening session, then disappear until the trip is ready. No 14-email back-and-forth.",
    steps: [
      {
        number: "01",
        title: "Listen once",
        body: "A call to understand what's worked on past anniversary trips, what hasn't, and what this milestone means.",
      },
      {
        number: "02",
        title: "Design once",
        body: "We send a single routed proposal we're confident in — based on what you told us. Refine if you want.",
      },
      {
        number: "03",
        title: "Book",
        body: "Everything secured, one beautiful itinerary, no decisions left for you.",
      },
      {
        number: "04",
        title: "Travel + remember",
        body: "We mark the date quietly on the trip. After you're home, we keep notes for next time. The repeat trip is one phone call away.",
      },
    ],
    testimonialQuote:
      "Twentieth anniversary. We told Momentella what we'd loved on our tenth, what we hadn't loved on our fifteenth, and we didn't say another word. They booked Crete. The hotel had us on a balcony with the same wine we drink at home. Already booked the twenty-fifth with them.",
    testimonialAttribution: "— A repeat Momentella couple",
    testimonialSublabel: "20th anniversary · Crete · 8 days",
  },

  {
    slug: "solo-travel",
    name: "Solo travel",
    formSlug: "solo-travel-intake",
    description: "Solo travel trip planning",
    metaTitle: "Solo Travel Planning · Momentella",
    metaDescription:
      "Boutique solo travel planning — for travelers who want safety, beauty, and time alone without spending the trip in logistics. Hotels, transfers, and rhythm designed for one.",
    heroEyebrow: "Solo travel",
    heroImageUrl:
      "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=2000&q=80",
    heroImageAlt: "A traveler with a journal in a quiet morning setting",
    heroHeadline: "Solo travel,",
    heroHeadlineMuted: "with the logistics taken off your shoulders.",
    heroBody:
      "Traveling alone is a particular kind of luxury — and a particular kind of vulnerability. We plan solo trips for travelers who want the freedom without the planning load. Hotels chosen for solo guests. Transfers handled. Pacing that respects how solo days actually feel.",
    introQuote: "A great solo trip",
    introQuoteMuted: "is mostly things you didn't have to worry about.",
    introParagraphs: [
      "Solo travel goes wrong in small ways: a hotel that feels uncomfortable when you're alone, a dinner table for one in a place that's loud and group-y, an arrival in a strange city at 11pm with no driver. None of those are fatal, but they accumulate.",
      "We plan to remove all of them. Hotels we've chosen specifically for solo travelers. Restaurants where eating alone is normal. Transfers handled door-to-door. A daily plan that has structure when you want it and space when you don't.",
    ],
    tilesEyebrow: "What changes",
    tilesTitle: "Designed for one traveler",
    tilesBody: "Solo travel needs different planning. We've done it enough to know what.",
    tiles: [
      {
        title: "Solo-friendly hotels",
        body: "Properties where you'll feel comfortable alone. Bars where it's normal to sit at the counter with a book. Breakfast rooms that aren't all couples and families. Smaller properties where staff actually learn your name.",
        imageUrl:
          "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Boutique hotel lobby with quiet morning light",
      },
      {
        title: "Door-to-door transfers",
        body: "No solo arrival in a strange airport hunting for a taxi. We have a driver waiting with your name. We handle every transit. Late flight, early flight — we plan for it.",
        imageUrl:
          "https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Calm boarding gate with soft light",
      },
      {
        title: "Solo-comfortable dinners",
        body: "Restaurants where eating alone isn't awkward — counter seating, a great book recommendation, a glass of wine the chef wants you to try. Booked with notes that you're solo so they can take care of you.",
        imageUrl:
          "https://images.unsplash.com/photo-1493558103817-58b2924bce98?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Quiet restaurant counter with a book and a glass of wine",
      },
      {
        title: "Optional structure",
        body: "Some days you'll want a guide, a class, a private boat. Some days you'll want to wander. We build both into the plan — bookings ready when you want them, optional, never mandatory.",
        imageUrl:
          "https://images.unsplash.com/photo-1500835556837-99ac94a94552?auto=format&fit=crop&w=1200&q=80",
        imageAlt: "Solo traveler on a guided morning walk",
      },
    ],
    stepsEyebrow: "How we plan",
    stepsTitle: "Calm, considered, comfortable solo",
    stepsBody: "From first call to safe return.",
    steps: [
      {
        number: "01",
        title: "Discover",
        body: "A call to learn what kind of solo traveler you are — extrovert, introvert, somewhere in between — and what scares you about traveling alone (we've heard it all).",
      },
      {
        number: "02",
        title: "Design",
        body: "A routed proposal with a daily structure that has more or less scaffolding depending on what you want. Refine until it feels right.",
      },
      {
        number: "03",
        title: "Book + brief",
        body: "Every transfer locked. Hotels notified you're solo and to take care of you. Restaurants briefed. One readable itinerary plus a single number to call if anything happens.",
      },
      {
        number: "04",
        title: "Travel + check-in",
        body: "We're a text away, and we'll quietly check in once or twice during the trip. You're free to actually be alone — without being unsupported.",
      },
    ],
    testimonialQuote:
      "I'd never traveled alone before. Two weeks in Portugal, post-divorce, and Adrienne walked me through every day of it like a friend who happened to know everyone. The hotel staff in Porto knew me by name on day two. The dinner table they gave me had a view of the river.",
    testimonialAttribution: "— A Momentella solo traveler",
    testimonialSublabel: "First solo trip · Portugal · 14 days",
  },
];
