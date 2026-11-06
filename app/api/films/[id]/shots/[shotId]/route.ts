import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CAMERA_MOTIONS, CLIP_DURATIONS, type CameraMotion } from "@/lib/fal";
import { stripEmDashes } from "@/lib/plan";

// PATCH /api/films/{id}/shots/{shotId}
// Body: any of { label, onScreenText, imagePrompt, motionPrompt, soundNote,
//                duration, cameraMotion, imageUrl, approved }
// Setting imageUrl by hand (a cover, a frame you made elsewhere) marks the
// still completed so the clip step can use it straight away.
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; shotId: string } },
) {
  const filmId = Number(params.id);
  const shotId = Number(params.shotId);
  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (typeof body.label === "string") data.label = stripEmDashes(body.label);
  if (typeof body.onScreenText === "string") data.onScreenText = stripEmDashes(body.onScreenText);
  if (typeof body.imagePrompt === "string") data.imagePrompt = stripEmDashes(body.imagePrompt);
  if (typeof body.motionPrompt === "string") data.motionPrompt = stripEmDashes(body.motionPrompt);
  if (typeof body.soundNote === "string") data.soundNote = stripEmDashes(body.soundNote);
  if (typeof body.approved === "boolean") data.approved = body.approved;

  if (body.duration !== undefined) {
    const d = Number(body.duration);
    if ((CLIP_DURATIONS as readonly number[]).includes(d)) data.duration = d;
  }
  if (typeof body.cameraMotion === "string") {
    const c = body.cameraMotion as CameraMotion;
    if (CAMERA_MOTIONS.includes(c)) data.cameraMotion = c;
  }
  if (typeof body.imageUrl === "string") {
    const url = body.imageUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: "imageUrl must be a public http(s) URL" }, { status: 400 });
    }
    data.imageUrl = url;
    data.imageStatus = url ? "completed" : "";
    data.imageRequestId = "";
    data.imageStatusUrl = "";
    data.imageResponseUrl = "";
    data.error = "";
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const shot = await prisma.shot
    .update({ where: { id: shotId, filmId }, data })
    .catch(() => null);
  if (!shot) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(shot);
}

// DELETE /api/films/{id}/shots/{shotId} -> drop a shot and close the gap.
export async function DELETE(
  _: Request,
  { params }: { params: { id: string; shotId: string } },
) {
  const filmId = Number(params.id);
  const shotId = Number(params.shotId);
  await prisma.shot.delete({ where: { id: shotId, filmId } }).catch(() => null);

  const rest = await prisma.shot.findMany({
    where: { filmId },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  await prisma.$transaction(
    rest.map((s, i) => prisma.shot.update({ where: { id: s.id }, data: { order: i } })),
  );
  return NextResponse.json({ ok: true });
}
