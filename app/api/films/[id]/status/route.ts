import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { extractImageUrl, extractVideoUrl, pollFal, type FalJob } from "@/lib/fal";

const inFlight = (s: string) => s === "queued" || s === "generating";

// GET /api/films/{id}/status
// Checks every still, clip and stitch job that is queued or generating,
// stores whatever finished, and returns the whole film. The studio polls
// this every few seconds while anything is in flight.
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  const film = await prisma.film.findUnique({
    where: { id },
    include: { shots: { orderBy: { order: "asc" } } },
  });
  if (!film) return NextResponse.json({ error: "not found" }, { status: 404 });

  const work: Promise<unknown>[] = [];

  for (const shot of film.shots) {
    if (inFlight(shot.imageStatus) && shot.imageStatusUrl) {
      const job: FalJob = {
        requestId: shot.imageRequestId,
        statusUrl: shot.imageStatusUrl,
        responseUrl: shot.imageResponseUrl,
      };
      work.push(
        pollFal(job)
          .then((r) => {
            if (r.status === "completed") {
              const url = extractImageUrl(r.output);
              return prisma.shot.update({
                where: { id: shot.id },
                data: url
                  ? { imageStatus: "completed", imageUrl: url, error: "" }
                  : { imageStatus: "failed", error: "fal returned no image url" },
              });
            }
            if (r.status === "failed") {
              return prisma.shot.update({
                where: { id: shot.id },
                data: { imageStatus: "failed", error: r.error || "still failed" },
              });
            }
            if (r.status !== shot.imageStatus) {
              return prisma.shot.update({
                where: { id: shot.id },
                data: { imageStatus: r.status },
              });
            }
            return null;
          })
          .catch((e) =>
            prisma.shot.update({
              where: { id: shot.id },
              data: { imageStatus: "failed", error: e instanceof Error ? e.message : String(e) },
            }),
          ),
      );
    }

    if (inFlight(shot.clipStatus) && shot.clipStatusUrl) {
      const job: FalJob = {
        requestId: shot.clipRequestId,
        statusUrl: shot.clipStatusUrl,
        responseUrl: shot.clipResponseUrl,
      };
      work.push(
        pollFal(job)
          .then((r) => {
            if (r.status === "completed") {
              const url = extractVideoUrl(r.output);
              return prisma.shot.update({
                where: { id: shot.id },
                data: url
                  ? { clipStatus: "completed", clipUrl: url, error: "" }
                  : { clipStatus: "failed", error: "fal returned no video url" },
              });
            }
            if (r.status === "failed") {
              return prisma.shot.update({
                where: { id: shot.id },
                data: { clipStatus: "failed", error: r.error || "clip failed" },
              });
            }
            if (r.status !== shot.clipStatus) {
              return prisma.shot.update({
                where: { id: shot.id },
                data: { clipStatus: r.status },
              });
            }
            return null;
          })
          .catch((e) =>
            prisma.shot.update({
              where: { id: shot.id },
              data: { clipStatus: "failed", error: e instanceof Error ? e.message : String(e) },
            }),
          ),
      );
    }
  }

  if (inFlight(film.finalStatus) && film.finalStatusUrl) {
    const job: FalJob = {
      requestId: film.finalRequestId,
      statusUrl: film.finalStatusUrl,
      responseUrl: film.finalResponseUrl,
    };
    work.push(
      pollFal(job)
        .then((r) => {
          if (r.status === "completed") {
            const url = extractVideoUrl(r.output);
            return prisma.film.update({
              where: { id },
              data: url
                ? { finalStatus: "completed", finalUrl: url, finalError: "" }
                : { finalStatus: "failed", finalError: "fal returned no video url" },
            });
          }
          if (r.status === "failed") {
            return prisma.film.update({
              where: { id },
              data: { finalStatus: "failed", finalError: r.error || "stitch failed" },
            });
          }
          if (r.status !== film.finalStatus) {
            return prisma.film.update({ where: { id }, data: { finalStatus: r.status } });
          }
          return null;
        })
        .catch((e) =>
          prisma.film.update({
            where: { id },
            data: { finalStatus: "failed", finalError: e instanceof Error ? e.message : String(e) },
          }),
        ),
    );
  }

  await Promise.all(work);

  const fresh = await prisma.film.findUnique({
    where: { id },
    include: { shots: { orderBy: { order: "asc" } } },
  });
  return NextResponse.json(fresh);
}
