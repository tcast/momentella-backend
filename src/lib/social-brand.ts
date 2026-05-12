/**
 * Brand-voice, platform conventions, and campaign templates for the
 * social-post generator. Centralized so any change to "how Momentella
 * sounds" only happens here, not scattered across prompts.
 */

/** Public-facing platform identifiers used in the DB. */
export const PLATFORMS = [
  "instagram_post",
  "instagram_reel",
  "instagram_story",
  "facebook_post",
  "tiktok",
] as const;
export type Platform = (typeof PLATFORMS)[number];

export type ContentType = "static" | "carousel" | "video" | "story";

export function defaultContentType(p: Platform): ContentType {
  switch (p) {
    case "instagram_post":
      return "static";
    case "instagram_reel":
    case "tiktok":
      return "video";
    case "instagram_story":
      return "story";
    case "facebook_post":
      return "static";
  }
}

export function platformLabel(p: Platform): string {
  switch (p) {
    case "instagram_post":
      return "Instagram post";
    case "instagram_reel":
      return "Instagram reel";
    case "instagram_story":
      return "Instagram story";
    case "facebook_post":
      return "Facebook post";
    case "tiktok":
      return "TikTok";
  }
}

/** Per-platform guidance baked into the user prompt. */
export function platformGuidance(p: Platform): string {
  switch (p) {
    case "instagram_post":
      return [
        "Format: a single feed image with caption.",
        "Caption length: 1,000–2,200 characters is fine, but the *first 125 characters* must hook before 'more'.",
        "Hashtags: 8–15, mix broad + niche, never spammy. Place at the end.",
        "Use 1–2 short paragraphs, line breaks, and one emoji max per paragraph (often zero).",
        "End with one clear, low-pressure CTA.",
      ].join(" ");
    case "instagram_reel":
      return [
        "Format: vertical video, 15–60 seconds.",
        "Provide a 'hook' that lands in the first 3 seconds — punchy, specific, curiosity-driven.",
        "Provide a scene-by-scene script (3–6 scenes). Each scene has a visual description, on-screen text overlay, and voiceover/spoken line. Each scene 3–10 seconds.",
        "Caption length: short (50–150 chars).",
        "Hashtags: 4–8, mix of broad + niche.",
        "Recommend a music/audio vibe (calm/cinematic, upbeat travel, etc).",
      ].join(" ");
    case "instagram_story":
      return [
        "Format: 9:16 single frame, very short, text-on-image.",
        "Caption is the *on-image text* — keep under 80 characters.",
        "Hashtags: 0–3 only; stories aren't a hashtag medium.",
        "Use a tap CTA like 'Tap to see more' or a sticker line.",
      ].join(" ");
    case "facebook_post":
      return [
        "Format: a single linkable post.",
        "Caption length: 80–250 characters is the sweet spot; first sentence must stand alone.",
        "Hashtags: 0–3 only; Facebook culture isn't hashtag-heavy.",
        "End with one direct CTA and an expected link placement (e.g. 'Plan with us → momentella.com/honeymoons').",
      ].join(" ");
    case "tiktok":
      return [
        "Format: vertical video, 15–60 seconds.",
        "Hook MUST be punchy in the first 2 seconds — text overlay + spoken line working together.",
        "Provide a scene-by-scene script (3–6 scenes) with visual, text overlay, and voiceover per scene.",
        "Caption length: 80–300 characters, conversational, can use 1–2 lowercase emojis.",
        "Hashtags: 3–6, mix one viral + niche (e.g. #babymoon #travelplanner #momentella).",
        "Recommend a trending audio category if relevant ('soft acoustic', 'cinematic strings', etc).",
      ].join(" ");
  }
}

/** The single source of truth for Momentella's brand voice. */
export const BRAND_VOICE_PROMPT = `You are Momentella's in-house social media writer.

About Momentella:
- A boutique family travel agency. Adrienne is the founder; small team, hands-on.
- We plan thoughtful trips that *fit real life*: cribs that actually exist, drivers who carry snacks, dinners booked early enough that bedtime still happens. We translate "we just want to enjoy the trip" into actual logistics so families don't have to.
- We serve: family vacations (babies + kids + teens), multigen trips, couples, honeymoons, babymoons, destination weddings, anniversary trips, solo travelers.
- Tone: calm, editorial, slightly literary. Quiet confidence, not breathless excitement. Real moments, never stock copy. Honest pacing. We are warm but never twee.
- Visual brand: ink-and-warm-paper palette, generous whitespace, slow film stills.

Voice rules (follow strictly):
- Write like a friend who happens to be exceptionally good at logistics. Specific over general — name the dish, the hour, the kid's age, the airport gate.
- Skip "epic", "ultimate", "unforgettable", "best ever", "destination of your dreams", "bucket list", "magical", "transformative", "wanderlust".
- No hype, no clickbait, no all-caps, no row-of-emoji shouting, no "DM us!" three times.
- Emojis: use sparingly. Often zero. One quiet emoji at the end of a thought is fine; never decorative chains.
- Hashtags: relevant first, vanity last. Always include #momentella as the closing hashtag for static posts where hashtags are appropriate.
- Always end with a low-pressure CTA that suggests action without begging: "We're a text away.", "Plan with us at the link in bio.", "Tell us about your trip — we'll handle the rest."
- For destination-specific content, mention *one* concrete sensory detail (a market, a meal, a window seat, a quiet park) — never a generic "stunning views" line.
- Mention pricing only when the campaign explicitly wants it. Otherwise focus on the *kind of trip* we plan.

When the prompt asks for video scripts, make each scene feel cinematic but doable on an iPhone — natural light, a single subject, no fancy stabilization required.`;

/** Brief used as the canonical campaign template. */
export interface CampaignTemplate {
  key: string;
  label: string;
  blurb: string;
  /** Suggested theme line (one sentence). */
  theme: string;
  /** Suggested CTA destination on momentella.com. */
  ctaHref: string;
  /** Suggested tone descriptors. */
  tone: string;
  /** Suggested goal. */
  goal: string;
  /** Optional admin nudges fed into the user prompt for richer drafts. */
  context?: string;
}

export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    key: "mothers_day_gift",
    label: "Mother's Day gift push",
    blurb: "Gift an itinerary-planning service for the mom who already has everything.",
    theme:
      "Skip the spa basket — gift a Momentella itinerary-planning service so she actually gets the trip done.",
    ctaHref: "/gift-certificates",
    tone: "warm, knowing, a little wry",
    goal: "gift_purchase",
    context:
      "We sell 1-, 2-, and 3-day itinerary planning packages as digital gift certificates. The recipient redeems online and we build their trip. Frame this as the rescue gift for moms who never get around to planning.",
  },
  {
    key: "fathers_day_gift",
    label: "Father's Day gift push",
    blurb: "Itinerary-planning gift cert for dads who say 'just plan something'.",
    theme:
      "For the dad who says 'just plan something nice' — gift a Momentella itinerary so he actually goes.",
    ctaHref: "/gift-certificates",
    tone: "warm, sly",
    goal: "gift_purchase",
  },
  {
    key: "babymoon_awareness",
    label: "Babymoon awareness",
    blurb: "Educate expecting parents that a planned babymoon = actual rest, not a logistics chore.",
    theme:
      "The last calm trip before everything changes — and the reason it takes planning to be actually calm.",
    ctaHref: "/babymoons",
    tone: "tender, calm, practical",
    goal: "intake_form",
  },
  {
    key: "honeymoon_season",
    label: "Honeymoon season",
    blurb: "Reach couples 4–9 months out from their wedding date.",
    theme:
      "Plan the trip first, the wedding second — why honeymoon planning belongs early in your engagement.",
    ctaHref: "/honeymoons",
    tone: "romantic, grounded, a little literary",
    goal: "intake_form",
  },
  {
    key: "family_summer",
    label: "Family summer planning window",
    blurb: "Spring nudge for families to book before the August school countdown hits.",
    theme:
      "The summer trip you'll actually take — booked before camp pickup eats every spare evening.",
    ctaHref: "/family-vacations",
    tone: "practical, reassuring",
    goal: "intake_form",
  },
  {
    key: "destination_spotlight",
    label: "Destination spotlight",
    blurb: "Show one destination through a specific, sensory moment.",
    theme:
      "A single specific reason this destination is worth the flight — told through one real moment.",
    ctaHref: "/connect",
    tone: "cinematic, sensory, slow",
    goal: "awareness",
    context:
      "Pick ONE concrete moment in the destination (a meal, a window, a corner of a market) and build the whole post around it. Skip the listicle voice.",
  },
  {
    key: "behind_the_scenes",
    label: "Behind the scenes",
    blurb: "Show how we plan — the spreadsheet, the calls, the room block.",
    theme:
      "What 'we'll plan it for you' actually looks like — 30 seconds of the spreadsheet, the call, the booking confirmation.",
    ctaHref: "/itinerary-planning",
    tone: "candid, grounded",
    goal: "awareness",
  },
  {
    key: "testimonial_highlight",
    label: "Client testimonial highlight",
    blurb: "Lead with a real quote, then explain what we planned.",
    theme:
      "Lead with a real moment from a recent client trip and what we handled so the trip felt that easy.",
    ctaHref: "/connect",
    tone: "warm, specific",
    goal: "awareness",
  },
];

export function campaignByKey(key: string | null | undefined): CampaignTemplate | null {
  if (!key) return null;
  return CAMPAIGN_TEMPLATES.find((c) => c.key === key) ?? null;
}

/** Recommended image aspect ratio for a platform. */
export function imageSizeFor(p: Platform): "1024x1024" | "1024x1792" | "1792x1024" {
  switch (p) {
    case "instagram_post":
      return "1024x1024";
    case "facebook_post":
      return "1792x1024";
    case "instagram_reel":
    case "instagram_story":
    case "tiktok":
      return "1024x1792";
  }
}
