/**
 * High-level orchestration for generating one social post draft from a
 * brief. Composes the brand-voice system prompt + platform conventions +
 * campaign template + admin-supplied brief, calls OpenAI in JSON mode,
 * and validates the response into a flat shape the DB can store.
 */

import { completeJson } from "./openai.js";
import {
  BRAND_VOICE_PROMPT,
  campaignByKey,
  platformGuidance,
  platformLabel,
  type ContentType,
  type Platform,
} from "./social-brand.js";

export interface GenerateBrief {
  platform: Platform;
  contentType: ContentType;
  campaignKey?: string | null;
  theme?: string | null;
  destination?: string | null;
  briefing?: string | null;
  tone?: string | null;
  goal?: string | null;
  /** If true, suggest a CTA href automatically. */
  autoCta?: boolean;
}

export interface ScriptScene {
  visual: string;
  textOverlay: string;
  voiceover: string;
  durationSec: number;
}

export interface VideoScript {
  hook: string;
  scenes: ScriptScene[];
  audioVibe: string;
}

export interface GeneratedDraft {
  caption: string;
  hashtags: string[];
  hook: string | null;
  script: VideoScript | null;
  cta: string;
  ctaHref: string | null;
  imagePrompt: string;
}

function buildUserPrompt(brief: GenerateBrief): string {
  const tmpl = campaignByKey(brief.campaignKey);
  const lines: string[] = [];
  lines.push(`Platform: ${platformLabel(brief.platform)} (${brief.contentType}).`);
  lines.push("");
  lines.push("Platform conventions:");
  lines.push(platformGuidance(brief.platform));
  lines.push("");

  if (tmpl) {
    lines.push(`Campaign: ${tmpl.label} — ${tmpl.blurb}`);
    lines.push(`Theme: ${brief.theme?.trim() || tmpl.theme}`);
    lines.push(`Suggested CTA destination: ${tmpl.ctaHref}`);
    if (tmpl.context) lines.push(`Extra context: ${tmpl.context}`);
    lines.push(`Suggested tone: ${brief.tone?.trim() || tmpl.tone}`);
    lines.push(`Goal: ${brief.goal?.trim() || tmpl.goal}`);
  } else {
    if (brief.theme) lines.push(`Theme: ${brief.theme}`);
    if (brief.tone) lines.push(`Tone: ${brief.tone}`);
    if (brief.goal) lines.push(`Goal: ${brief.goal}`);
  }
  if (brief.destination) lines.push(`Destination focus: ${brief.destination}`);
  if (brief.briefing) {
    lines.push("");
    lines.push("Admin notes / extras (treat as ground truth):");
    lines.push(brief.briefing);
  }

  lines.push("");
  lines.push("Return JSON exactly matching this TypeScript type — no markdown, no commentary outside the JSON:");
  lines.push("```");
  lines.push("{");
  lines.push("  caption: string;             // ready-to-paste caption in Momentella voice");
  lines.push("  hashtags: string[];          // each starts with '#', lowercase, no spaces");
  lines.push("  hook: string | null;         // only for reels/tiktoks — first 3 seconds");
  lines.push("  script: {");
  lines.push("    hook: string;");
  lines.push("    audioVibe: string;");
  lines.push("    scenes: Array<{ visual: string; textOverlay: string; voiceover: string; durationSec: number }>;");
  lines.push("  } | null;                    // null for static / story / facebook_post");
  lines.push("  cta: string;                 // one short CTA line");
  lines.push("  ctaHref: string | null;      // pathname on momentella.com or null");
  lines.push("  imagePrompt: string;         // a vivid, brand-on prompt to generate an image for this post");
  lines.push("}");
  lines.push("```");
  lines.push("");
  lines.push("Critical: imagePrompt must describe a single, calm, editorial scene with natural light, real-feeling — not stock-y, no banners, no text in the image.");
  return lines.join("\n");
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x): x is string => x.length > 0)
    .map((x) => (x.startsWith("#") ? x : `#${x}`))
    .map((x) => x.replace(/\s+/g, "").toLowerCase());
}

function parseScript(v: unknown): VideoScript | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const scenesRaw = Array.isArray(o.scenes) ? o.scenes : [];
  const scenes: ScriptScene[] = scenesRaw
    .map((s) => {
      if (!s || typeof s !== "object") return null;
      const x = s as Record<string, unknown>;
      const dur =
        typeof x.durationSec === "number" && Number.isFinite(x.durationSec)
          ? Math.max(1, Math.min(30, Math.round(x.durationSec)))
          : 5;
      return {
        visual: asString(x.visual),
        textOverlay: asString(x.textOverlay),
        voiceover: asString(x.voiceover),
        durationSec: dur,
      };
    })
    .filter((x): x is ScriptScene => !!x && x.visual.length > 0);
  if (scenes.length === 0) return null;
  return {
    hook: asString(o.hook),
    audioVibe: asString(o.audioVibe),
    scenes,
  };
}

/** Generate one social-post draft from a brief. Throws on API errors. */
export async function generateSocialDraft(
  brief: GenerateBrief,
): Promise<GeneratedDraft> {
  const user = buildUserPrompt(brief);
  const raw = await completeJson<Record<string, unknown>>({
    system: BRAND_VOICE_PROMPT,
    user,
    // Slightly above default for stronger voice but not chaotic.
    temperature: 0.75,
  });
  const caption = asString(raw.caption).trim();
  const cta = asString(raw.cta).trim();
  const imagePrompt = asString(raw.imagePrompt).trim();
  const ctaHrefRaw = asString(raw.ctaHref).trim();
  const ctaHref = ctaHrefRaw && ctaHrefRaw.startsWith("/") ? ctaHrefRaw : null;
  const hookRaw = asString(raw.hook).trim();
  const hashtags = asStringArray(raw.hashtags);
  const script =
    brief.contentType === "video" ? parseScript(raw.script) : null;
  const hook = hookRaw || script?.hook || null;
  if (!caption) {
    throw new Error("Generator returned empty caption.");
  }
  return {
    caption,
    hashtags,
    hook,
    script,
    cta,
    ctaHref,
    imagePrompt:
      imagePrompt ||
      `Editorial, natural-light photograph in the Momentella style. ${brief.destination ?? "Travel scene"}. Calm composition, warm palette, no text.`,
  };
}
