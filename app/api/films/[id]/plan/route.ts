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
import type { FilmFormat } from "@/lib/fal";

export const maxDuration = 60;

// POST /api/films/{id}/plan
// Body: { notes?, sourceText? }
// Re-runs the planner and REPLACES every shot (stills and clips included).
// The client confirms before calling this.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const limit = rateLimit(`film-plan:${clientIp(req)}`, 6, 60);
  if (!limit.ok) return rateLimitResponse(limit);

  const id = Number(params.id);
  const existing = await prisma.film.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const notes: string =
    typeof body.notes === "string" ? body.notes.trim() : existing.notes;
  const sourceText: string =
    typeof body.sourceText === "string" && body.sourceText.trim().length >= 40
      ? body.sourceText.trim().slice(0, SOURCE_TEXT_MAX)
      : existing.sourceText;

  if (sourceText.length < 40) {
    return NextResponse.json(
      { error: "This film has no source text. Add a blurb or excerpt first." },
      { status: 400 },
    );
  }

  try {
    const raw = await complete({
      user: trailerPlanPrompt({
        bookTitle: existing.bookTitle || existing.title,
        format: existing.format as FilmFormat,
        sourceText,
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

    await prisma.$transaction([
      prisma.shot.deleteMany({ where: { filmId: id } }),
      prisma.film.update({
        where: { id },
        data: {
          notes,
          sourceText,
          logline: plan.logline,
          storyBible: stringifyJSON(plan.storyBible),
          music: stringifyJSON(plan.music),
          cta: plan.cta,
          finalRequestId: "",
          finalStatusUrl: "",
          finalResponseUrl: "",
          finalStatus: "",
          finalUrl: "",
          finalError: "",
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
      }),
    ]);

    const film = await prisma.film.findUnique({
      where: { id },
      include: { shots: { orderBy: { order: "asc" } } },
    });
    return NextResponse.json(film);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
