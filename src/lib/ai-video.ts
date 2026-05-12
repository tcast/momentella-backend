/**
 * HeyGen AI avatar video client. Lets admins turn a social-post script
 * into a finished talking-head video — useful when Adrienne can't get
 * in front of a camera and just needs the reel done.
 *
 * Submission is async: we POST a generation job, get back a `video_id`,
 * then poll for status until "completed" before pulling the final video
 * URL into our DB.
 *
 * Env:
 *   HEYGEN_API_KEY            required
 *   HEYGEN_AVATAR_ID          optional, default "Daisy-inskirt-20220818"
 *                             (a calm, soft-lit female avatar that suits
 *                             Momentella). Override with any avatar from
 *                             your HeyGen library.
 *   HEYGEN_VOICE_ID           optional, default a warm female voice.
 *
 * HeyGen API docs reference:
 *   POST   https://api.heygen.com/v2/video/generate
 *   GET    https://api.heygen.com/v1/video_status.get?video_id=...
 */

const DEFAULT_AVATAR_ID = "Daisy-inskirt-20220818";
const DEFAULT_VOICE_ID = "1bd001e7e50f421d891986aad5158bc8";

export function isHeyGenConfigured(): boolean {
  return Boolean(process.env.HEYGEN_API_KEY?.trim());
}

function key(): string {
  const k = process.env.HEYGEN_API_KEY?.trim();
  if (!k) {
    throw new Error(
      "HeyGen is not configured. Set HEYGEN_API_KEY on the API service.",
    );
  }
  return k;
}

export function defaultAvatarId(): string {
  return process.env.HEYGEN_AVATAR_ID?.trim() || DEFAULT_AVATAR_ID;
}

export function defaultVoiceId(): string {
  return process.env.HEYGEN_VOICE_ID?.trim() || DEFAULT_VOICE_ID;
}

export class HeyGenError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`HeyGen request failed (${status}): ${body.slice(0, 400)}`);
    this.name = "HeyGenError";
    this.status = status;
  }
}

export interface SubmitVideoInput {
  script: string;
  /** Vertical 9:16 for reels/TikTok; 16:9 for FB; 1:1 for IG feed. */
  aspect: "9:16" | "16:9" | "1:1";
  avatarId?: string;
  voiceId?: string;
}

export interface SubmitVideoResult {
  videoId: string;
  avatarId: string;
  voiceId: string;
}

/** Submit a generation job. Returns immediately with a job id to poll. */
export async function submitHeyGenVideo(
  input: SubmitVideoInput,
): Promise<SubmitVideoResult> {
  const avatarId = input.avatarId?.trim() || defaultAvatarId();
  const voiceId = input.voiceId?.trim() || defaultVoiceId();
  const dim =
    input.aspect === "9:16"
      ? { width: 720, height: 1280 }
      : input.aspect === "16:9"
        ? { width: 1280, height: 720 }
        : { width: 1080, height: 1080 };
  const body = {
    video_inputs: [
      {
        character: {
          type: "avatar",
          avatar_id: avatarId,
          avatar_style: "normal",
        },
        voice: {
          type: "text",
          input_text: input.script,
          voice_id: voiceId,
        },
        background: { type: "color", value: "#f8f4ec" },
      },
    ],
    dimension: dim,
    aspect_ratio: input.aspect,
    test: false,
  };
  const controller = new AbortController();
  const tm = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch("https://api.heygen.com/v2/video/generate", {
      method: "POST",
      headers: {
        "X-Api-Key": key(),
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(tm);
  }
  const text = await res.text();
  if (!res.ok) throw new HeyGenError(res.status, text);
  type Resp = { data?: { video_id?: string }; error?: unknown };
  let parsed: Resp;
  try {
    parsed = JSON.parse(text) as Resp;
  } catch {
    throw new HeyGenError(res.status, `bad outer JSON: ${text.slice(0, 200)}`);
  }
  const videoId = parsed.data?.video_id;
  if (!videoId) {
    throw new HeyGenError(res.status, `no video_id in response: ${text.slice(0, 200)}`);
  }
  return { videoId, avatarId, voiceId };
}

export type HeyGenJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface HeyGenStatusResult {
  status: HeyGenJobStatus;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  durationSec: number | null;
  errorMessage: string | null;
}

/** Check generation status. Returns video URL when status === "completed". */
export async function getHeyGenStatus(
  videoId: string,
): Promise<HeyGenStatusResult> {
  const controller = new AbortController();
  const tm = setTimeout(() => controller.abort(), 20_000);
  let res: Response;
  try {
    res = await fetch(
      `https://api.heygen.com/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`,
      {
        method: "GET",
        headers: { "X-Api-Key": key() },
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(tm);
  }
  const text = await res.text();
  if (!res.ok) throw new HeyGenError(res.status, text);
  type Resp = {
    data?: {
      status?: string;
      video_url?: string;
      thumbnail_url?: string;
      duration?: number;
      error?: { detail?: string; message?: string } | string;
    };
  };
  let parsed: Resp;
  try {
    parsed = JSON.parse(text) as Resp;
  } catch {
    throw new HeyGenError(res.status, `bad outer JSON: ${text.slice(0, 200)}`);
  }
  const raw = parsed.data?.status?.toLowerCase() ?? "pending";
  const status: HeyGenJobStatus =
    raw === "completed"
      ? "completed"
      : raw === "failed"
        ? "failed"
        : raw === "processing"
          ? "processing"
          : "pending";
  let errMsg: string | null = null;
  if (typeof parsed.data?.error === "string") {
    errMsg = parsed.data.error;
  } else if (parsed.data?.error && typeof parsed.data.error === "object") {
    errMsg =
      parsed.data.error.detail ?? parsed.data.error.message ?? null;
  }
  return {
    status,
    videoUrl: parsed.data?.video_url ?? null,
    thumbnailUrl: parsed.data?.thumbnail_url ?? null,
    durationSec: typeof parsed.data?.duration === "number" ? Math.round(parsed.data.duration) : null,
    errorMessage: errMsg,
  };
}

/**
 * Compose the per-platform aspect ratio used when submitting to HeyGen.
 * Mirrors the social-brand image sizing.
 */
export function aspectForPlatform(
  platform: string,
): "9:16" | "16:9" | "1:1" {
  if (platform === "instagram_reel" || platform === "tiktok" || platform === "instagram_story") {
    return "9:16";
  }
  if (platform === "facebook_post") return "16:9";
  return "1:1";
}

/**
 * Turn a video-script JSON into a single voiceover script that HeyGen
 * speaks back-to-back. Hook first, then each scene's voiceover line,
 * lightly separated with pauses.
 */
export function scriptToVoiceoverText(script: unknown): string {
  if (!script || typeof script !== "object") return "";
  const obj = script as Record<string, unknown>;
  const lines: string[] = [];
  const hook = typeof obj.hook === "string" ? obj.hook.trim() : "";
  if (hook) lines.push(hook);
  const scenes = Array.isArray(obj.scenes) ? obj.scenes : [];
  for (const s of scenes) {
    if (s && typeof s === "object") {
      const vo = (s as Record<string, unknown>).voiceover;
      if (typeof vo === "string" && vo.trim()) lines.push(vo.trim());
    }
  }
  return lines.join("\n\n");
}
