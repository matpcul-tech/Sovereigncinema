import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { mergeInput, submitFal, MERGE_ENDPOINT } from "@/lib/fal";

// POST /api/films/{id}/stitch
// Body: { approvedOnly?: boolean }
// Concatenates the finished clips in shot order into one MP4 (native audio
// carried through). Titles, cover and music go on in the editor afterwards.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const limit = rateLimit(`film-stitch:${clientIp(req)}`, 6, 60);
  if (!limit.ok) return rateLimitResponse(limit);

  const id = Number(params.id);
  const body = await req.json().catch(() => ({}));
  const approvedOnly: boolean = body.approvedOnly === true;

  const film = await prisma.film.findUnique({
    where: { id },
    include: { shots: { orderBy: { order: "asc" } } },
  });
  if (!film) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (film.finalStatus === "queued" || film.finalStatus === "generating") {
    return NextResponse.json({ error: "A stitch is already running." }, { status: 409 });
  }

  const clips = film.shots
    .filter((s) => s.clipStatus === "completed" && !!s.clipUrl)
    .filter((s) => (approvedOnly ? s.approved : true))
    .map((s) => s.clipUrl);

  if (clips.length < 2) {
    return NextResponse.json(
      {
        error: approvedOnly
          ? "Approve at least two finished clips to stitch a cut."
          : "Render at least two clips before stitching.",
      },
      { status: 400 },
    );
  }

  try {
    const job = await submitFal(MERGE_ENDPOINT, mergeInput(clips));
    const fresh = await prisma.film.update({
      where: { id },
      data: {
        finalRequestId: job.requestId,
        finalStatusUrl: job.statusUrl,
        finalResponseUrl: job.responseUrl,
        finalStatus: "queued",
        finalUrl: "",
        finalError: "",
      },
      include: { shots: { orderBy: { order: "asc" } } },
    });
    return NextResponse.json({ clips: clips.length, film: fresh });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.film
      .update({ where: { id }, data: { finalStatus: "failed", finalError: msg } })
      .catch(() => null);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
