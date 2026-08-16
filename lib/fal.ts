// fal.ai integration for the Trailer Studio.
//
// Three jobs run through fal's queue API:
//   1. Keyframe stills   (default fal-ai/flux/dev, override with FAL_IMAGE_MODEL)
//   2. Clips             (LTX-2.5 image-to-video, fast or pro tier)
//   3. Stitched cut      (fal-ai/ffmpeg-api/merge-videos, free)
//
// Every job is async: submit, get a request id plus status/response URLs,
// then poll until COMPLETED. We persist the URLs fal hands back rather than
// rebuilding them, because endpoints with sub-paths (image-to-video/fast)
// report status on the parent app path.
//
// Set FAL_KEY in env. Get one at https://fal.ai/dashboard/keys.

const QUEUE = "https://queue.fal.run";

export type FilmFormat = "9:16" | "16:9";
export type ClipResolution = "720p" | "1080p";
export type ClipTier = "fast" | "pro";
export type CameraMotion =
  | ""
  | "static"
  | "dolly_in"
  | "dolly_out"
  | "dolly_left"
  | "dolly_right"
  | "jib_up"
  | "jib_down"
  | "focus_shift";

export const CAMERA_MOTIONS: CameraMotion[] = [
  "",
  "static",
  "dolly_in",
  "dolly_out",
  "dolly_left",
  "dolly_right",
  "jib_up",
  "jib_down",
  "focus_shift",
];

export const CLIP_DURATIONS = [6, 8, 10] as const;
export type ClipDuration = (typeof CLIP_DURATIONS)[number];

export const LTX_ENDPOINTS: Record<ClipTier, string> = {
  fast: "lightricks/ltx-2.5/image-to-video/fast",
  pro: "lightricks/ltx-2.5/image-to-video/pro",
};

export const MERGE_ENDPOINT = "fal-ai/ffmpeg-api/merge-videos";

// Any fal text-to-image endpoint that accepts { prompt, image_size } works here.
export function imageEndpoint(): string {
  return process.env.FAL_IMAGE_MODEL || "fal-ai/flux/dev";
}

// USD per second of generated video, native audio included (fal list price,
// August 2026). Kept here so the UI can show a cost estimate before a batch.
export const CLIP_PRICE_PER_SECOND: Record<ClipTier, Record<ClipResolution, number>> = {
  fast: { "720p": 0.09, "1080p": 0.13 },
  pro: { "720p": 0.12, "1080p": 0.17 },
};

// Rough per-still cost for the default keyframe model.
export const IMAGE_PRICE_EST = 0.03;

export function clipPrice(tier: ClipTier, resolution: ClipResolution, seconds: number): number {
  return (CLIP_PRICE_PER_SECOND[tier]?.[resolution] ?? 0.13) * seconds;
}

export type FalJob = {
  requestId: string;
  statusUrl: string;
  responseUrl: string;
};

export type FalJobStatus = "queued" | "generating" | "completed" | "failed";

export type FalPoll = {
  status: FalJobStatus;
  output?: Record<string, unknown>;
  error?: string;
  queuePosition?: number;
};

function apiKey(): string {
  const key = process.env.FAL_KEY;
  if (!key) {
    throw new Error("FAL_KEY is not set. Add it to .env.local, see .env.example.");
  }
  return key;
}

function headers(): HeadersInit {
  return {
    Authorization: `Key ${apiKey()}`,
    "Content-Type": "application/json",
  };
}

function falError(json: unknown, status: number): string {
  const j = (json ?? {}) as Record<string, unknown>;
  const detail = j.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const item = d as Record<string, unknown>;
        return typeof item?.msg === "string" ? item.msg : JSON.stringify(item);
      })
      .join("; ");
  }
  const err = j.error as Record<string, unknown> | string | undefined;
  if (typeof err === "string") return err;
  if (err && typeof err.message === "string") return err.message;
  if (typeof j.message === "string") return j.message;
  return `fal ${status}`;
}

// Submit a job to the queue. Returns the ids/urls to poll.
export async function submitFal(
  endpoint: string,
  input: Record<string, unknown>,
): Promise<FalJob> {
  const res = await fetch(`${QUEUE}/${endpoint}`, {
    method: "POST",
    headers: headers(),
    cache: "no-store",
    body: JSON.stringify(input),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(falError(json, res.status));

  const requestId = String(json.request_id ?? "");
  if (!requestId) throw new Error("fal did not return a request_id");

  return {
    requestId,
    statusUrl: String(json.status_url ?? `${QUEUE}/${endpoint}/requests/${requestId}/status`),
    responseUrl: String(json.response_url ?? `${QUEUE}/${endpoint}/requests/${requestId}`),
  };
}

// Poll a job. When completed, output holds the endpoint's result payload.
export async function pollFal(job: FalJob): Promise<FalPoll> {
  const st = await fetch(job.statusUrl, { headers: headers(), cache: "no-store" });
  const sj = (await st.json().catch(() => ({}))) as Record<string, unknown>;
  if (!st.ok) return { status: "failed", error: falError(sj, st.status) };

  const raw = String(sj.status ?? "").toUpperCase();
  if (raw === "IN_QUEUE") {
    return { status: "queued", queuePosition: Number(sj.queue_position ?? 0) };
  }
  if (raw === "IN_PROGRESS") return { status: "generating" };
  if (raw !== "COMPLETED") {
    return { status: "failed", error: falError(sj, st.status) || `fal status ${raw || "unknown"}` };
  }

  const rr = await fetch(job.responseUrl, { headers: headers(), cache: "no-store" });
  const rj = (await rr.json().catch(() => ({}))) as Record<string, unknown>;
  if (!rr.ok) return { status: "failed", error: falError(rj, rr.status) };
  return { status: "completed", output: rj };
}

// Pull the media URL out of the three result shapes we care about.
export function extractImageUrl(output: Record<string, unknown> | undefined): string {
  const images = output?.images;
  if (Array.isArray(images) && images[0]) {
    const first = images[0] as Record<string, unknown>;
    if (typeof first.url === "string") return first.url;
  }
  const image = output?.image as Record<string, unknown> | undefined;
  if (image && typeof image.url === "string") return image.url;
  return "";
}

export function extractVideoUrl(output: Record<string, unknown> | undefined): string {
  const video = output?.video as Record<string, unknown> | undefined;
  if (video && typeof video.url === "string") return video.url;
  return "";
}

// Job builders. Kept in one place so prompts, sizes and enums stay in sync
// with what the endpoints accept.

export function keyframeInput(prompt: string, format: FilmFormat, seed?: number) {
  return {
    prompt,
    image_size: format === "9:16" ? "portrait_16_9" : "landscape_16_9",
    num_images: 1,
    output_format: "jpeg",
    enable_safety_checker: true,
    ...(seed ? { seed } : {}),
  };
}

export function clipInput(opts: {
  imageUrl: string;
  prompt: string;
  duration: number;
  format: FilmFormat;
  resolution: ClipResolution;
  cameraMotion?: CameraMotion;
}) {
  const duration = CLIP_DURATIONS.includes(opts.duration as ClipDuration)
    ? opts.duration
    : 6;
  return {
    image_url: opts.imageUrl,
    prompt: opts.prompt,
    duration,
    resolution: opts.resolution,
    aspect_ratio: opts.format,
    fps: 25,
    generate_audio: true,
    ...(opts.cameraMotion ? { camera_motion: opts.cameraMotion } : {}),
  };
}

export function mergeInput(videoUrls: string[]) {
  return {
    video_urls: videoUrls,
    target_fps: 25,
    resolution_aspect_ratio_video_index: 0,
  };
}
