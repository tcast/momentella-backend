/**
 * High-level orchestration for generating one (or many) social post drafts
 * from a brief. Composes the brand-voice system prompt + platform
 * conventions + campaign template + admin-supplied brief, dispatches to
 * the requested AI provider (or "auto"), and normalizes the response into
 * a flat shape the DB can store.
 */

import {
  AIProviderError,
  completeJson,
  configuredTextProviders,
  pickTextProvider,
  providerLabel,
  type TextProviderName,
} from "./ai-providers.js";
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

export interface GeneratedDraftWithProvider {
  draft: GeneratedDraft;
  provider: TextProviderName;
  providerLabel: string;
  model: string;
}

export interface CompareResultRow {
  provider: TextProviderName;
  providerLabel: string;
  model: string;
  draft: GeneratedDraft | null;
  error: string | null;
}

const POST_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    hook: { type: "string" },
    script: {
      type: "object",
      properties: {
        hook: { type: "string" },
        audioVibe: { type: "string" },
        scenes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              visual: { type: "string" },
              textOverlay: { type: "string" },
              voiceover: { type: "string" },
              durationSec: { type: "number" },
            },
            required: ["visual"],
          },
        },
      },
    },
    cta: { type: "string" },
    ctaHref: { type: "string" },
    imagePrompt: { type: "string" },
  },
  required: ["caption", "hashtags", "cta", "imagePrompt"],
};

const SCHEMA_DESCRIPTION = `Return JSON matching this shape:
{
  caption: string (ready-to-paste caption in Momentella voice),
  hashtags: string[] (each starts with '#', lowercase, no spaces),
  hook: string | null (only for reels/tiktoks — first 3 seconds),
  script: { hook: string, audioVibe: string, scenes: Array<{ visual: string, textOverlay: string, voiceover: string, durationSec: number }> } | null (null for static/story/facebook_post),
  cta: string (one short CTA line),
  ctaHref: string | null (pathname on momentella.com or null),
  imagePrompt: string (vivid, brand-on prompt — calm editorial scene, natural light, no text in image)
}`;

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
  lines.push(
    "Critical: imagePrompt must describe a single, calm, editorial scene with natural light, real-feeling — not stock-y, no banners, no text in the image.",
  );
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

function normalize(raw: Record<string, unknown>, brief: GenerateBrief): GeneratedDraft {
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

/**
 * Resolve "auto"/explicit provider to a concrete `TextProviderName`. Throws
 * if the requested provider isn't configured and no fallback exists.
 */
export function resolveProvider(
  requested: TextProviderName | "auto" | null | undefined,
  brief: GenerateBrief,
): TextProviderName {
  if (requested && requested !== "auto") {
    const available = configuredTextProviders();
    if (available.includes(requested)) return requested;
    // requested provider missing — fall back if possible
    const fallback = pickTextProvider({ contentType: brief.contentType });
    if (!fallback) {
      throw new Error(
        `${providerLabel(requested)} isn't configured and no other AI provider is available either.`,
      );
    }
    return fallback;
  }
  const auto = pickTextProvider({ contentType: brief.contentType });
  if (!auto) {
    throw new Error(
      "No AI provider is configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or GEMINI_API_KEY.",
    );
  }
  return auto;
}

/** Generate one social-post draft using the specified provider. */
export async function generateSocialDraft(
  brief: GenerateBrief,
  provider: TextProviderName,
): Promise<GeneratedDraftWithProvider> {
  const user = buildUserPrompt(brief);
  const out = await completeJson<Record<string, unknown>>(provider, {
    system: BRAND_VOICE_PROMPT,
    user,
    schemaDescription: SCHEMA_DESCRIPTION,
    schema: POST_SCHEMA,
    temperature: 0.75,
  });
  return {
    draft: normalize(out.data, brief),
    provider: out.provider,
    providerLabel: out.providerLabel,
    model: out.model,
  };
}

/**
 * Fan the same brief out to every configured text provider in parallel
 * and return a row per provider (some may have errors). Used by the
 * "Compare all 3" wizard mode.
 */
export async function generateSocialDraftsCompare(
  brief: GenerateBrief,
): Promise<CompareResultRow[]> {
  const providers = configuredTextProviders();
  if (providers.length === 0) {
    throw new Error("No AI provider is configured.");
  }
  const rows = await Promise.all(
    providers.map(async (p): Promise<CompareResultRow> => {
      try {
        const r = await generateSocialDraft(brief, p);
        return {
          provider: r.provider,
          providerLabel: r.providerLabel,
          model: r.model,
          draft: r.draft,
          error: null,
        };
      } catch (err) {
        const msg = err instanceof AIProviderError
          ? `${err.status}: ${err.bodyText.slice(0, 120)}`
          : err instanceof Error
            ? err.message
            : "Generation failed";
        return {
          provider: p,
          providerLabel: providerLabel(p),
          model: "",
          draft: null,
          error: msg,
        };
      }
    }),
  );
  return rows;
}
