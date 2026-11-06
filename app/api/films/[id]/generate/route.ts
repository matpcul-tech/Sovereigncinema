import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  clipInput,
  clipPrice,
  imageEndpoint,
  keyframeInput,
  submitFal,
  LTX_ENDPOINTS,
  type CameraMotion,
  type ClipResolution,
  type ClipTier,
  type FilmFormat,
} from "@/lib/fal";

// POST /api/films/{id}/generate
// Body: { kind: "image" | "clip", shotIds?: number[], force?: boolean }
//
// image: renders a keyframe still for each selected shot (all shots without a
//        still when shotIds is omitted; force re-renders even if one exists).
// clip:  animates each selected shot's still with LTX-2.5 (all shots that have
//        a still but no finished clip when shotIds is omitted).
//
// Jobs are submitted, not awaited. Poll /api/films/{id}/status.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const limit = rateLimit(`film-gen:${clientIp(req)}`, 20, 60);
  if (!limit.ok) return rateLimitResponse(limit);

  const id = Number(params.id);
  const body = await req.json().catch(() => ({}));
  const kind: "image" | "clip" = body.kind === "clip" ? "clip" : "image";
  const force: boolean = body.force === true;
  const requested: number[] | null = Array.isArray(body.shotIds)
    ? body.shotIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n))
    : null;

  const film = await prisma.film.findUnique({
    where: { id },
    include: { shots: { orderBy: { order: "asc" } } },
  });
  if (!film) return NextResponse.json({ error: "not found" }, { status: 404 });

  const format = film.format as FilmFormat;
  const resolution = film.resolution as ClipResolution;
  const tier = film.tier as ClipTier;

  const inFlight = (s: string) => s === "queued" || s === "generating";

  const targets = film.shots.filter((s) => {
    if (requested && !requested.includes(s.id)) return false;
    if (kind === "image") {
      if (inFlight(s.imageStatus)) return false;
      return force || requested ? true : !s.imageUrl;
    }
    if (inFlight(s.clipStatus)) return false;
    if (!s.imageUrl) return false;
    return force || requested ? true : s.clipStatus !== "completed";
  });

  if (targets.length === 0) {
    return NextResponse.json(
      {
        error:
          kind === "clip"
            ? "Nothing to render. Every shot with a still already has a clip, or the selected shots have no still yet."
            : "Nothing to render. Every shot already has a still.",
      },
      { status: 400 },
    );
  }

  // Cost guard: a batch of clips is real money, cap it per call.
  const MAX_CLIPS_PER_CALL = 12;
  if (kind === "clip" && targets.length > MAX_CLIPS_PER_CALL) {
    return NextResponse.json(
      { error: `Too many clips in one batch (${targets.length}). Cap is ${MAX_CLIPS_PER_CALL}.` },
      { status: 400 },
    );
  }

  const results: Array<{ shotId: number; ok: boolean; error?: string }> = [];
  let estimatedCost = 0;

  for (const shot of targets) {
    try {
      if (kind === "image") {
        if (!shot.imagePrompt.trim()) throw new Error("image prompt is empty");
        const job = await submitFal(
          imageEndpoint(),
          keyframeInput(shot.imagePrompt, format, film.seed || undefined),
        );
        await prisma.shot.update({
          where: { id: shot.id },
          data: {
            imageStatus: "queued",
            imageRequestId: job.requestId,
            imageStatusUrl: job.statusUrl,
            imageResponseUrl: job.responseUrl,
            error: "",
          },
        });
      } else {
        if (!shot.motionPrompt.trim()) throw new Error("motion prompt is empty");
        const job = await submitFal(
          LTX_ENDPOINTS[tier],
          clipInput({
            imageUrl: shot.imageUrl,
            prompt: shot.motionPrompt,
            duration: shot.duration,
            format,
            resolution,
            cameraMotion: shot.cameraMotion as CameraMotion,
          }),
        );
        estimatedCost += clipPrice(tier, resolution, shot.duration);
        await prisma.shot.update({
          where: { id: shot.id },
          data: {
            clipStatus: "queued",
            clipRequestId: job.requestId,
            clipStatusUrl: job.statusUrl,
            clipResponseUrl: job.responseUrl,
            error: "",
            approved: false,
          },
        });
        // A new clip invalidates any stitched cut.
        if (film.finalUrl || film.finalStatus) {
          await prisma.film.update({
            where: { id },
            data: {
              finalRequestId: "",
              finalStatusUrl: "",
              finalResponseUrl: "",
              finalStatus: "",
              finalUrl: "",
              finalError: "",
            },
          });
        }
      }
      results.push({ shotId: shot.id, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.shot
        .update({
          where: { id: shot.id },
          data: kind === "image" ? { imageStatus: "failed", error: msg } : { clipStatus: "failed", error: msg },
        })
        .catch(() => null);
      results.push({ shotId: shot.id, ok: false, error: msg });
    }
  }

  const fresh = await prisma.film.findUnique({
    where: { id },
    include: { shots: { orderBy: { order: "asc" } } },
  });

  return NextResponse.json({
    submitted: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
    estimatedCost: Number(estimatedCost.toFixed(2)),
    film: fresh,
  });
}
