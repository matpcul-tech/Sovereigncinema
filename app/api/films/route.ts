import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { complete } from "@/lib/anthropic";
import { stringifyJSON } from "@/lib/utils";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  normalizePlan,
  trailerPlanPrompt,
  trailerPlanSchema,
  SOURCE_TEXT_MAX,
} from "@/lib/plan";
import type { FilmFormat, ClipResolution, ClipTier } from "@/lib/fal";

// Planning runs a full Opus call; give it room on Vercel.
export const maxDuration = 60;

// GET /api/films -> every film with its shot count and render progress.
export async function GET() {
  const films = await prisma.film.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      shots: {
        select: { id: true, imageStatus: true, clipStatus: true, imageUrl: true, clipUrl: true },
      },
    },
  });

  return NextResponse.json(
    films.map((t) => ({
      id: t.id,
      title: t.title,
      bookTitle: t.bookTitle,
      mode: t.mode,
      format: t.format,
      resolution: t.resolution,
      tier: t.tier,
      logline: t.logline,
      finalStatus: t.finalStatus,
      finalUrl: t.finalUrl,
      updatedAt: t.updatedAt,
      shotCount: t.shots.length,
      stillsDone: t.shots.filter((s) => !!s.imageUrl).length,
      clipsDone: t.shots.filter((s) => s.clipStatus === "completed" && !!s.clipUrl).length,
    })),
  );
}

// POST /api/films
// Body: { title?, bookTitle, mode?, format?, resolution?, tier?, sourceText, notes? }
// Runs the planner and creates the film plus its shots in one go.
export async function POST(req: Request) {
  const limit = rateLimit(`film-plan:${clientIp(req)}`, 6, 60);
  if (!limit.ok) return rateLimitResponse(limit);

  const body = await req.json();
  const bookTitle: string = (body.bookTitle ?? body.title ?? "").trim();
  const mode: "trailer" | "film" = body.mode === "film" ? "film" : "trailer";
  const title: string = (body.title ?? "").trim() || `${bookTitle} ${mode}`;
  const sourceText: string = (body.sourceText ?? "").trim();
  const notes: string = (body.notes ?? "").trim();
  const format: FilmFormat = body.format === "16:9" ? "16:9" : "9:16";
  const resolution: ClipResolution = body.resolution === "720p" ? "720p" : "1080p";
  const tier: ClipTier = body.tier === "pro" ? "pro" : "fast";

  if (!bookTitle) {
    return NextResponse.json({ error: "bookTitle required" }, { status: 400 });
  }
  if (sourceText.length < 40) {
    return NextResponse.json(
      { error: "Paste at least a blurb (40+ characters) so the planner has a story to work from." },
      { status: 400 },
    );
  }

  try {
    const raw = await complete({
      user: trailerPlanPrompt({
        bookTitle,
        format,
        sourceText: sourceText.slice(0, SOURCE_TEXT_MAX),
        notes,
      }),
      jsonSchema: trailerPlanSchema as unknown as Record<string, unknown>,
      effort: "high",
      maxTokens: 16000,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "AI returned non-JSON", raw }, { status: 500 });
    }
    const plan = normalizePlan(parsed);

    const film = await prisma.film.create({
      data: {
        title,
        bookTitle,
        mode,
        format,
        resolution,
        tier,
        sourceText: sourceText.slice(0, SOURCE_TEXT_MAX),
        notes,
        logline: plan.logline,
        storyBible: stringifyJSON(plan.storyBible),
        music: stringifyJSON(plan.music),
        cta: plan.cta,
        seed: Math.floor(Math.random() * 2_000_000_000) + 1,
        shots: {
          create: plan.shots.map((s, i) => ({
            order: i,
            beat: s.beat,
            label: s.label,
            onScreenText: s.onScreenText,
            imagePrompt: s.imagePrompt,
            motionPrompt: s.motionPrompt,
            soundNote: s.soundNote,
            duration: s.duration,
            cameraMotion: s.cameraMotion,
          })),
        },
      },
      select: { id: true },
    });

    return NextResponse.json({ id: film.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
