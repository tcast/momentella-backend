/**
 * Thin OpenAI client. Used by the social-post generator to produce
 * captions/hashtags/scripts (text) and accompanying imagery.
 *
 * We deliberately avoid the official `openai` SDK to keep the dependency
 * graph tiny — these are simple JSON-over-HTTPS calls. All requests go
 * through `fetch`, with explicit timeouts and structured errors.
 *
 * Text generation uses the modern Responses API at /v1/responses (the old
 * Chat Completions `response_format` parameter was removed by OpenAI in
 * 2026). Image generation still uses /v1/images/generations with
 * gpt-image-1.
 *
 * Env:
 *   OPENAI_API_KEY    required for any generation
 *   OPENAI_BASE_URL   optional override, default https://api.openai.com/v1
 *   OPENAI_TEXT_MODEL optional, default gpt-5.5 (current top chat model)
 *   OPENAI_IMAGE_MODEL optional, default gpt-image-1
 */

const DEFAULT_TEXT_MODEL = "gpt-5.5";
const DEFAULT_IMAGE_MODEL = "gpt-image-1";

function baseUrl(): string {
  return (
    process.env.OPENAI_BASE_URL?.trim().replace(/\/$/, "") ||
    "https://api.openai.com/v1"
  );
}

export class OpenAINotConfigured extends Error {
  constructor() {
    super(
      "OpenAI is not configured. Set OPENAI_API_KEY in the backend environment to enable AI generation.",
    );
    this.name = "OpenAINotConfigured";
  }
}

export class OpenAIRequestError extends Error {
  readonly status: number;
  readonly bodyText: string;
  constructor(status: number, bodyText: string) {
    super(`OpenAI request failed (${status}): ${bodyText.slice(0, 400)}`);
    this.name = "OpenAIRequestError";
    this.status = status;
    this.bodyText = bodyText;
  }
}

export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function apiKey(): string {
  const k = process.env.OPENAI_API_KEY?.trim();
  if (!k) throw new OpenAINotConfigured();
  return k;
}

export interface CompleteJsonOptions {
  system: string;
  user: string;
  model?: string;
  /** Higher = more creative. 0.7 is the social-content sweet spot. */
  temperature?: number;
  /** ms; default 120 000 — Responses API can be slower for big models. */
  timeoutMs?: number;
}

/**
 * Responses API JSON output. Item types include "reasoning" (for o-series
 * models) and "message". We only care about the first "message" item.
 */
interface ResponsesAPIResponse {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  /** Fallback short-form helper added in newer SDK responses. */
  output_text?: string;
}

function extractOutputText(json: ResponsesAPIResponse): string {
  if (typeof json.output_text === "string" && json.output_text) {
    return json.output_text;
  }
  if (!Array.isArray(json.output)) return "";
  for (const item of json.output) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const c of item.content) {
      if (c.type === "output_text" && typeof c.text === "string") {
        return c.text;
      }
    }
  }
  return "";
}

/**
 * Generate a JSON object via the Responses API. The user prompt must
 * contain the literal word "JSON" somewhere — when text.format is
 * "json_object", OpenAI enforces this as a guardrail.
 */
export async function completeJson<T = unknown>(
  opts: CompleteJsonOptions,
): Promise<T> {
  const model = opts.model ?? process.env.OPENAI_TEXT_MODEL?.trim() ?? DEFAULT_TEXT_MODEL;
  const body: Record<string, unknown> = {
    model,
    instructions: opts.system,
    input: opts.user,
    text: { format: { type: "json_object" as const } },
  };
  // Temperature is rejected by gpt-5.* and o-series models on the Responses
  // API (they use internal sampling). Only pass it for legacy chat-tier
  // models that still accept it. Caller can opt in explicitly.
  const tempModelAllowsIt =
    typeof opts.temperature === "number" &&
    !/^(gpt-5|gpt-5\.|o\d)/i.test(model);
  if (tempModelAllowsIt) {
    body.temperature = opts.temperature;
  }
  const controller = new AbortController();
  const tm = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(tm);
  }
  const text = await res.text();
  if (!res.ok) throw new OpenAIRequestError(res.status, text);
  let json: ResponsesAPIResponse;
  try {
    json = JSON.parse(text) as ResponsesAPIResponse;
  } catch {
    throw new OpenAIRequestError(res.status, `bad outer JSON: ${text.slice(0, 200)}`);
  }
  const raw = extractOutputText(json);
  if (!raw) {
    throw new OpenAIRequestError(
      res.status,
      `empty output_text in response: ${text.slice(0, 200)}`,
    );
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new OpenAIRequestError(
      res.status,
      `model returned non-JSON content: ${raw.slice(0, 200)}`,
    );
  }
}

export type ImageSize = "1024x1024" | "1024x1792" | "1792x1024";

export interface GenerateImageOptions {
  prompt: string;
  size?: ImageSize;
  model?: string;
  /** ms; default 180 000 — image gen is slower than text. */
  timeoutMs?: number;
}

/**
 * Generates a single image and returns its bytes. gpt-image-1 returns
 * base64-encoded PNG by default; we accept both that and the older URL
 * form for forward compatibility.
 */
export async function generateImage(
  opts: GenerateImageOptions,
): Promise<{ bytes: Buffer; contentType: string; size: ImageSize }> {
  const size: ImageSize = opts.size ?? "1024x1024";
  const body: Record<string, unknown> = {
    model:
      opts.model ?? process.env.OPENAI_IMAGE_MODEL?.trim() ?? DEFAULT_IMAGE_MODEL,
    prompt: opts.prompt,
    size,
    n: 1,
  };
  const controller = new AbortController();
  const tm = setTimeout(() => controller.abort(), opts.timeoutMs ?? 180_000);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(tm);
  }
  const text = await res.text();
  if (!res.ok) throw new OpenAIRequestError(res.status, text);
  type ImageGenResponse = {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  let json: ImageGenResponse;
  try {
    json = JSON.parse(text) as ImageGenResponse;
  } catch {
    throw new OpenAIRequestError(res.status, `bad outer JSON: ${text.slice(0, 200)}`);
  }
  const b64 = json.data?.[0]?.b64_json;
  if (b64) {
    return {
      bytes: Buffer.from(b64, "base64"),
      contentType: "image/png",
      size,
    };
  }
  const url = json.data?.[0]?.url;
  if (url) {
    const r2 = await fetch(url);
    if (!r2.ok) {
      throw new OpenAIRequestError(r2.status, `image url fetch failed: ${url}`);
    }
    const buf = Buffer.from(await r2.arrayBuffer());
    return { bytes: buf, contentType: r2.headers.get("content-type") ?? "image/png", size };
  }
  throw new OpenAIRequestError(res.status, "image response missing both b64_json and url");
}
