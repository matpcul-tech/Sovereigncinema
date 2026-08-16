import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { stripEmDashes } from "@/lib/plan";

// GET /api/films/{id} -> the film with its shots in order.
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const film = await prisma.film.findUnique({
    where: { id },
    include: { shots: { orderBy: { order: "asc" } } },
  });
  if (!film) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(film);
}

// PATCH /api/films/{id}
// Body: any of { title, bookTitle, format, resolution, tier, notes, cta }
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (typeof body.title === "string" && body.title.trim()) data.title = stripEmDashes(body.title);
  if (typeof body.bookTitle === "string") data.bookTitle = stripEmDashes(body.bookTitle);
  if (body.format === "9:16" || body.format === "16:9") data.format = body.format;
  if (body.resolution === "720p" || body.resolution === "1080p") data.resolution = body.resolution;
  if (body.tier === "fast" || body.tier === "pro") data.tier = body.tier;
  if (typeof body.notes === "string") data.notes = stripEmDashes(body.notes);
  if (typeof body.cta === "string") data.cta = stripEmDashes(body.cta);

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const film = await prisma.film
    .update({
      where: { id },
      data,
      include: { shots: { orderBy: { order: "asc" } } },
    })
    .catch(() => null);
  if (!film) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(film);
}

// DELETE /api/films/{id} -> removes the film and its shots (cascade).
export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  await prisma.film.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
