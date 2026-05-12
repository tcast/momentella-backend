/**
 * Thin OpenAI client. Used by the social-post generator to produce
 * captions/hashtags/scripts (text) and accompanying imagery.
 *
 * We deliberately avoid the official `openai` SDK to keep the dependency
 * graph tiny — these are simple JSON-over-HTTPS calls. All requests go
 * through `fetch`, with explicit timeouts and structured errors.
 *
 * Env:
 *   OPENAI_API_KEY    required for any generation
 *   OPENAI_BASE_URL   optional override, default https://api.openai.com/v1
 *   OPENAI_TEXT_MODEL optional, default gpt-4o-mini  (cheap, fast, strong)
 *   OPENAI_IMAGE_MODEL optional, default gpt-image-1 (DALL·E successor)
 */

const DEFAULT_TEXT_MODEL = "gpt-4o-mini";
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

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { role: string; content?: string | null };
  }>;
}

export interface CompleteJsonOptions {
  system: string;
  user: string;
  model?: string;
  /** Higher = more creative. 0.7 is the social-content sweet spot. */
  temperature?: number;
  /** ms; default 60 000. */
  timeoutMs?: number;
}

/**
 * Calls OpenAI chat completions with JSON-mode and returns the parsed JSON
 * object. The caller must include `Return JSON like ...` in the user prompt;
 * we enforce `response_format: { type: "json_object" }` so the model can't
 * stray into markdown.
 */
export async function completeJson<T = unknown>(
  opts: CompleteJsonOptions,
): Promise<T> {
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  const body = {
    model: opts.model ?? process.env.OPENAI_TEXT_MODEL?.trim() ?? DEFAULT_TEXT_MODEL,
    messages,
    temperature: opts.temperature ?? 0.7,
    response_format: { type: "json_object" as const },
  };
  const controller = new AbortController();
  const tm = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/chat/completions`, {
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
  let json: ChatCompletionResponse;
  try {
    json = JSON.parse(text) as ChatCompletionResponse;
  } catch {
    throw new OpenAIRequestError(res.status, `bad outer JSON: ${text.slice(0, 200)}`);
  }
  const raw = json.choices?.[0]?.message?.content ?? "";
  if (!raw) throw new OpenAIRequestError(res.status, "empty completion content");
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
  /** ms; default 120 000 — image gen is slower than text. */
  timeoutMs?: number;
}

/**
 * Generates a single image and returns its bytes. We always request
 * base64-encoded PNG so it's trivial to forward straight to object storage.
 */
export async function generateImage(
  opts: GenerateImageOptions,
): Promise<{ bytes: Buffer; contentType: string; size: ImageSize }> {
  const size: ImageSize = opts.size ?? "1024x1024";
  const body = {
    model:
      opts.model ?? process.env.OPENAI_IMAGE_MODEL?.trim() ?? DEFAULT_IMAGE_MODEL,
    prompt: opts.prompt,
    size,
    n: 1,
    // gpt-image-1 always returns b64 by default; pinning makes intent obvious.
    response_format: "b64_json" as const,
  };
  const controller = new AbortController();
  const tm = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
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
