/**
 * Multi-provider AI abstraction for the social-post generator.
 *
 * Three text providers — OpenAI ChatGPT, Anthropic Claude, Google Gemini —
 * exposed behind a single `completeJson` shape. Two image providers —
 * OpenAI `gpt-image-1` and Google `imagen-3` — exposed behind a single
 * `generateImage` shape.
 *
 * Each provider is "configured" iff its API key is present. Higher-level
 * code can pick a specific provider, or pass "auto" to let us route to the
 * provider best suited for the task (and fall through to whichever is
 * available). A `compare` mode fans the same prompt out to every
 * configured text provider in parallel so the admin can pick the best
 * draft visually.
 *
 * Env vars:
 *   OPENAI_API_KEY               required for OpenAI text + images
 *   OPENAI_TEXT_MODEL            optional, default gpt-4o-mini
 *   OPENAI_IMAGE_MODEL           optional, default gpt-image-1
 *
 *   ANTHROPIC_API_KEY            required for Claude text
 *   ANTHROPIC_TEXT_MODEL         optional, default claude-3-5-sonnet-latest
 *
 *   GEMINI_API_KEY               required for Gemini text + Imagen
 *   GEMINI_TEXT_MODEL            optional, default gemini-2.0-flash
 *   GEMINI_IMAGE_MODEL           optional, default imagen-3.0-generate-002
 */

import { generateImage as openaiGenerateImage, completeJson as openaiCompleteJson, OpenAIRequestError, type ImageSize } from "./openai.js";

export type TextProviderName = "openai" | "anthropic" | "gemini";
export type ImageProviderName = "openai" | "gemini";

export interface TextProviderInfo {
  name: TextProviderName;
  label: string;
  model: string;
  configured: boolean;
}

export interface ImageProviderInfo {
  name: ImageProviderName;
  label: string;
  model: string;
  configured: boolean;
}

export interface CompleteJsonArgs {
  system: string;
  user: string;
  /** Plain English description of the JSON shape — included in the prompt. */
  schemaDescription: string;
  /** Optional JSON schema (only Gemini / Anthropic tool-use will actually enforce). */
  schema?: Record<string, unknown>;
  temperature?: number;
  /** ms timeout; default 90s. */
  timeoutMs?: number;
}

export interface CompleteJsonResult<T = unknown> {
  data: T;
  provider: TextProviderName;
  providerLabel: string;
  model: string;
}

// ─── Configuration helpers ──────────────────────────────────────────────

function modelOpenAI(): string {
  // GPT-5.5 (released 2026-04-23): current top chat-tier model on the
  // Responses API. Override via OPENAI_TEXT_MODEL — gpt-5.4-mini is the
  // cheapest current mini model for high-volume drafts.
  return process.env.OPENAI_TEXT_MODEL?.trim() || "gpt-5.5";
}
function modelAnthropic(): string {
  // Claude Opus 4.7 (released 2026-04-14): Anthropic's current top model.
  // Strongest editorial writing of any provider. Override via env
  // (e.g. `claude-sonnet-4-6` for ~5x cheaper drafts that are still great).
  return process.env.ANTHROPIC_TEXT_MODEL?.trim() || "claude-opus-4-7";
}
function modelGemini(): string {
  // Gemini 2.5 Pro: Google's writing-quality tier. Override via env
  // (e.g. `gemini-2.5-flash` for faster/cheaper drafts).
  return process.env.GEMINI_TEXT_MODEL?.trim() || "gemini-2.5-pro";
}
function modelGeminiImage(): string {
  // "Nano Banana" — Google's :generateContent image model. Far better
  // than the older Imagen models and uses the same endpoint as text gen.
  // Override to `gemini-3-pro-image-preview` ("Nano Banana Pro") for
  // top quality if its availability has stabilized.
  return process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-2.5-flash-image";
}

function keyOpenAI(): string | null {
  return process.env.OPENAI_API_KEY?.trim() || null;
}
function keyAnthropic(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}
function keyGemini(): string | null {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_AI_API_KEY?.trim() ||
    null
  );
}

export function textProviderInfo(): TextProviderInfo[] {
  return [
    {
      name: "anthropic",
      label: "Claude",
      model: modelAnthropic(),
      configured: !!keyAnthropic(),
    },
    {
      name: "openai",
      label: "ChatGPT",
      model: modelOpenAI(),
      configured: !!keyOpenAI(),
    },
    {
      name: "gemini",
      label: "Gemini",
      model: modelGemini(),
      configured: !!keyGemini(),
    },
  ];
}

export function imageProviderInfo(): ImageProviderInfo[] {
  return [
    {
      name: "openai",
      label: "OpenAI · gpt-image-1",
      model: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1",
      configured: !!keyOpenAI(),
    },
    {
      name: "gemini",
      label: "Google · Imagen 3",
      model: modelGeminiImage(),
      configured: !!keyGemini(),
    },
  ];
}

export function configuredTextProviders(): TextProviderName[] {
  return textProviderInfo()
    .filter((p) => p.configured)
    .map((p) => p.name);
}

export function configuredImageProviders(): ImageProviderName[] {
  return imageProviderInfo()
    .filter((p) => p.configured)
    .map((p) => p.name);
}

export function providerLabel(name: TextProviderName | ImageProviderName): string {
  if (name === "openai") return "ChatGPT";
  if (name === "anthropic") return "Claude";
  return "Gemini";
}

// ─── Auto-routing logic ─────────────────────────────────────────────────

/**
 * Pick the best text provider for a given platform/contentType pair, falling
 * back to whichever provider is actually configured. Returns null if none
 * are configured.
 */
export function pickTextProvider(opts: {
  contentType: "static" | "carousel" | "video" | "story";
}): TextProviderName | null {
  const available = configuredTextProviders();
  if (available.length === 0) return null;

  // Preferences by task. Claude writes the best long editorial captions.
  // GPT is most reliable at structured JSON (video scripts). Gemini is
  // fastest / strongest at short punchy hooks and tags.
  const preference: TextProviderName[] =
    opts.contentType === "video"
      ? ["openai", "anthropic", "gemini"]
      : opts.contentType === "story"
        ? ["gemini", "anthropic", "openai"]
        : ["anthropic", "openai", "gemini"];

  for (const p of preference) {
    if (available.includes(p)) return p;
  }
  return available[0] ?? null;
}

/** Pick image provider; OpenAI primary, Gemini fallback. */
export function pickImageProvider(): ImageProviderName | null {
  const available = configuredImageProviders();
  if (available.length === 0) return null;
  if (available.includes("openai")) return "openai";
  return available[0] ?? null;
}

// ─── Generic provider error ─────────────────────────────────────────────

export class AIProviderError extends Error {
  readonly provider: TextProviderName | ImageProviderName;
  readonly status: number;
  readonly bodyText: string;
  constructor(
    provider: TextProviderName | ImageProviderName,
    status: number,
    bodyText: string,
  ) {
    super(
      `${providerLabel(provider)} request failed (${status}): ${bodyText.slice(0, 400)}`,
    );
    this.name = "AIProviderError";
    this.provider = provider;
    this.status = status;
    this.bodyText = bodyText;
  }
}

// ─── Text providers ─────────────────────────────────────────────────────

export async function completeJson<T = unknown>(
  provider: TextProviderName,
  args: CompleteJsonArgs,
): Promise<CompleteJsonResult<T>> {
  if (provider === "openai") {
    if (!keyOpenAI()) throw new Error("OpenAI is not configured.");
    try {
      // OpenAI's JSON mode requires the literal word "JSON" to appear in the
      // request. The schema description always contains it, so we just
      // concatenate it onto the user prompt — same shape Anthropic + Gemini
      // are already getting.
      const data = await openaiCompleteJson<T>({
        system: args.system,
        user: `${args.user}\n\n${args.schemaDescription}`,
        temperature: args.temperature,
        timeoutMs: args.timeoutMs,
      });
      return {
        data,
        provider: "openai",
        providerLabel: "ChatGPT",
        model: modelOpenAI(),
      };
    } catch (err) {
      if (err instanceof OpenAIRequestError) {
        throw new AIProviderError("openai", err.status, err.bodyText);
      }
      throw err;
    }
  }
  if (provider === "anthropic") {
    return completeJsonAnthropic<T>(args);
  }
  return completeJsonGemini<T>(args);
}

async function completeJsonAnthropic<T>(
  args: CompleteJsonArgs,
): Promise<CompleteJsonResult<T>> {
  const key = keyAnthropic();
  if (!key) throw new Error("Anthropic is not configured.");
  const model = modelAnthropic();
  // Claude doesn't have a strict JSON mode, but tool-use guarantees a JSON
  // shape when we `tool_choice` a specific tool. We define a "return_post"
  // tool whose input schema is the result we want. This is the most
  // reliable way to get structured JSON from Claude in 2026.
  const tool = {
    name: "return_post",
    description: "Return the generated social post draft.",
    input_schema: args.schema ?? {
      type: "object",
      additionalProperties: true,
    },
  };
  const body = {
    model,
    max_tokens: 2000,
    temperature: args.temperature ?? 0.75,
    system: args.system,
    tools: [tool],
    tool_choice: { type: "tool", name: "return_post" },
    messages: [
      {
        role: "user",
        content: `${args.user}\n\nReturn your answer by calling the return_post tool. ${args.schemaDescription}`,
      },
    ],
  };
  const controller = new AbortController();
  const tm = setTimeout(() => controller.abort(), args.timeoutMs ?? 90_000);
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(tm);
  }
  const text = await res.text();
  if (!res.ok) throw new AIProviderError("anthropic", res.status, text);
  type AnthropicResp = {
    content?: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; name: string; input: unknown }
    >;
  };
  let parsed: AnthropicResp;
  try {
    parsed = JSON.parse(text) as AnthropicResp;
  } catch {
    throw new AIProviderError("anthropic", res.status, `bad outer JSON: ${text.slice(0, 200)}`);
  }
  const tu = parsed.content?.find(
    (b): b is { type: "tool_use"; name: string; input: unknown } =>
      b.type === "tool_use" && b.name === "return_post",
  );
  if (!tu) {
    throw new AIProviderError(
      "anthropic",
      res.status,
      `no return_post tool_use in response: ${text.slice(0, 200)}`,
    );
  }
  return {
    data: tu.input as T,
    provider: "anthropic",
    providerLabel: "Claude",
    model,
  };
}

async function completeJsonGemini<T>(
  args: CompleteJsonArgs,
): Promise<CompleteJsonResult<T>> {
  const key = keyGemini();
  if (!key) throw new Error("Gemini is not configured.");
  const model = modelGemini();
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: args.system }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: `${args.user}\n\n${args.schemaDescription}` },
        ],
      },
    ],
    generationConfig: {
      temperature: args.temperature ?? 0.75,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      ...(args.schema ? { responseSchema: args.schema } : {}),
    },
  };
  const controller = new AbortController();
  const tm = setTimeout(() => controller.abort(), args.timeoutMs ?? 90_000);
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(tm);
  }
  const text = await res.text();
  if (!res.ok) throw new AIProviderError("gemini", res.status, text);
  type GeminiResp = {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  let parsed: GeminiResp;
  try {
    parsed = JSON.parse(text) as GeminiResp;
  } catch {
    throw new AIProviderError("gemini", res.status, `bad outer JSON: ${text.slice(0, 200)}`);
  }
  const out = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) {
    throw new AIProviderError(
      "gemini",
      res.status,
      `empty completion: ${text.slice(0, 200)}`,
    );
  }
  let data: T;
  try {
    data = JSON.parse(out) as T;
  } catch {
    throw new AIProviderError(
      "gemini",
      res.status,
      `model returned non-JSON: ${out.slice(0, 200)}`,
    );
  }
  return { data, provider: "gemini", providerLabel: "Gemini", model };
}

// ─── Image providers ────────────────────────────────────────────────────

export interface GeneratedImage {
  bytes: Buffer;
  contentType: string;
  size: ImageSize;
  provider: ImageProviderName;
  model: string;
}

export async function generateImage(opts: {
  prompt: string;
  size?: ImageSize;
  provider?: ImageProviderName | "auto";
}): Promise<GeneratedImage> {
  const size: ImageSize = opts.size ?? "1024x1024";
  const chosen: ImageProviderName | null =
    opts.provider && opts.provider !== "auto" ? opts.provider : pickImageProvider();
  if (!chosen) {
    throw new Error(
      "No image generator is configured. Set OPENAI_API_KEY (recommended) or GEMINI_API_KEY.",
    );
  }
  if (chosen === "openai") {
    try {
      const out = await openaiGenerateImage({ prompt: opts.prompt, size });
      return {
        bytes: out.bytes,
        contentType: out.contentType,
        size: out.size,
        provider: "openai",
        model: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1",
      };
    } catch (err) {
      if (err instanceof OpenAIRequestError) {
        throw new AIProviderError("openai", err.status, err.bodyText);
      }
      throw err;
    }
  }
  return generateImageGemini(opts.prompt, size);
}

async function generateImageGemini(
  prompt: string,
  size: ImageSize,
): Promise<GeneratedImage> {
  const key = keyGemini();
  if (!key) throw new Error("Gemini is not configured.");
  const model = modelGeminiImage();
  // "Nano Banana" models accept aspect ratio as a natural-language hint
  // in the prompt — they don't have a dedicated parameter for it. We
  // weave the platform aspect into the prompt itself.
  const aspectHint =
    size === "1024x1024"
      ? "Square 1:1 composition."
      : size === "1024x1792"
        ? "Vertical 9:16 composition — composed for Instagram reels / TikTok."
        : "Landscape 16:9 composition.";
  const body = {
    contents: [
      {
        parts: [{ text: `${prompt}\n\n${aspectHint}` }],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
    },
  };
  const controller = new AbortController();
  const tm = setTimeout(() => controller.abort(), 180_000);
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(tm);
  }
  const text = await res.text();
  if (!res.ok) throw new AIProviderError("gemini", res.status, text);
  type NanoBananaResp = {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { mimeType?: string; data?: string };
        }>;
      };
    }>;
  };
  let parsed: NanoBananaResp;
  try {
    parsed = JSON.parse(text) as NanoBananaResp;
  } catch {
    throw new AIProviderError("gemini", res.status, `bad outer JSON: ${text.slice(0, 200)}`);
  }
  for (const cand of parsed.candidates ?? []) {
    for (const p of cand.content?.parts ?? []) {
      if (p.inlineData?.data) {
        return {
          bytes: Buffer.from(p.inlineData.data, "base64"),
          contentType: p.inlineData.mimeType || "image/png",
          size,
          provider: "gemini",
          model,
        };
      }
    }
  }
  throw new AIProviderError(
    "gemini",
    res.status,
    `no image bytes in response: ${text.slice(0, 200)}`,
  );
}
