/**
 * ElevenLabs text-to-speech client. Used to turn the social-post
 * scene-by-scene script voiceover lines into MP3 audio files admins can
 * drop into reels/TikToks they're cutting in CapCut/InShot/etc.
 *
 * Env:
 *   ELEVENLABS_API_KEY     required
 *   ELEVENLABS_VOICE_ID    optional, default "EXAVITQu4vr4xnSDxMaL" (Sarah,
 *                          warm + grounded — good fit for Momentella voice).
 *                          Adrienne can clone her own voice in the ElevenLabs
 *                          dashboard and drop the new ID in this env var to
 *                          have every voiceover come out in her voice.
 *   ELEVENLABS_MODEL_ID    optional, default "eleven_multilingual_v2"
 */

/** Default voice — a warm, grounded female voice that suits Momentella. */
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

export function isElevenLabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

function key(): string {
  const k = process.env.ELEVENLABS_API_KEY?.trim();
  if (!k) {
    throw new Error(
      "ElevenLabs is not configured. Set ELEVENLABS_API_KEY on the API service.",
    );
  }
  return k;
}

export function defaultVoiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID;
}

export function defaultModelId(): string {
  return process.env.ELEVENLABS_MODEL_ID?.trim() || DEFAULT_MODEL_ID;
}

export class ElevenLabsError extends Error {
  readonly status: number;
  constructor(status: number, body: string) {
    super(`ElevenLabs request failed (${status}): ${body.slice(0, 400)}`);
    this.name = "ElevenLabsError";
    this.status = status;
  }
}

export interface VoiceoverInput {
  text: string;
  voiceId?: string;
  modelId?: string;
  /** ms timeout — TTS is fast; default 60 000. */
  timeoutMs?: number;
}

export interface VoiceoverResult {
  bytes: Buffer;
  contentType: string;
  voiceId: string;
  modelId: string;
}

/**
 * Synthesize one MP3 voiceover. Returns the raw bytes — caller decides
 * what to do (typically store in R2 and attach to a script scene).
 */
export async function generateVoiceover(
  input: VoiceoverInput,
): Promise<VoiceoverResult> {
  const text = input.text?.trim();
  if (!text) throw new Error("Voiceover text is empty.");
  const voiceId = input.voiceId?.trim() || defaultVoiceId();
  const modelId = input.modelId?.trim() || defaultModelId();
  const controller = new AbortController();
  const tm = setTimeout(() => controller.abort(), input.timeoutMs ?? 60_000);
  let res: Response;
  try {
    res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": key(),
          "content-type": "application/json",
          accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            // Gentle, grounded delivery — not over-emotive.
            stability: 0.5,
            similarity_boost: 0.7,
            style: 0.2,
            use_speaker_boost: true,
          },
        }),
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(tm);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ElevenLabsError(res.status, body);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    bytes: buf,
    contentType: res.headers.get("content-type") || "audio/mpeg",
    voiceId,
    modelId,
  };
}

/**
 * Rough duration estimate from MP3 bytes — ElevenLabs returns variable bit
 * rate so this is approximate. Use ~16 KB/sec (128 kbps) as the heuristic.
 */
export function estimateAudioDurationSec(bytes: number): number {
  return Math.max(1, Math.round(bytes / 16_000));
}
