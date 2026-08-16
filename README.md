# Sovereign Cinema (working title)

Books to trailers to films, shot by shot, on infrastructure you control.

Paste a blurb, a synopsis, or a chapter. Claude writes a story bible and a
shot list. Each shot becomes a still, each still becomes an LTX-2.5 clip with
native audio, and the clips stitch into one cut you finish in CapCut with the
title card, cover, overlays and your own score.

Rename the product in one place: `NEXT_PUBLIC_APP_NAME` in `.env.local` / Vercel.

## Modes

| Mode | Status | What it does |
|---|---|---|
| Trailer | live | 7 to 9 shots, 40 to 60 seconds, story-beat structure (hook, world, protagonist, threat, turn, stakes, title, cta) |
| Continuity (film) | next | Scenes and shots where every clip ends on the next clip's first frame, a cast sheet with reference stills, longer clips. Schema already carries `mode`, `cast`, `sceneLabel`, `endImageUrl` for it. |

## Pipeline

1. Plan: `POST /api/films` runs Claude (structured JSON) and stores the film plus its shots.
2. Stills: `POST /api/films/{id}/generate` with `kind: "image"` renders keyframes on fal (default `fal-ai/flux/dev`, override with `FAL_IMAGE_MODEL`). Every still prompt opens with the story bible anchors so shots read as one film.
3. Clips: `kind: "clip"` animates each still with `lightricks/ltx-2.5/image-to-video/{fast|pro}` at the film's format, resolution and duration. Native audio on.
4. Poll: `GET /api/films/{id}/status` checks every in-flight fal job and writes results back. The studio polls it every 4 seconds while anything renders.
5. Stitch: `POST /api/films/{id}/stitch` joins finished clips in shot order with `fal-ai/ffmpeg-api/merge-videos` (free).
6. Finish in the editor. Overlays, title card, cover art and music are never rendered by the model.

## Stack

- Next.js 14 (App Router), TypeScript, React 18, Tailwind 3
- Postgres via Prisma (any `postgres://` URL: Neon, Vercel Postgres, Supabase)
- `@anthropic-ai/sdk` with adaptive thinking and `json_schema` output for the planner
- fal.ai queue API (plain fetch, no SDK) for stills, clips and the stitch
- Single-user password sign-in with an HMAC session cookie (same pattern as Creator OS)
- Sovereign design system: navy `#07101f`, gold `#d4a843`, teal `#00d4b8`, Playfair Display + Outfit, dark cards, sovereign indicator on every screen

## Costs (fal list price, August 2026)

| Item | Price |
|---|---|
| Still (flux/dev) | about $0.03 |
| LTX-2.5 Fast clip | $0.09/s at 720p, $0.13/s at 1080p |
| LTX-2.5 Pro clip | $0.12/s at 720p, $0.17/s at 1080p |
| Stitch | free |

A 50-second trailer at 1080p Fast is about $6.50 plus retakes. The studio shows the estimate on every button before it spends anything.

## Setup (from a phone)

1. GitHub: create an empty repo and push this project to it (see `CLAUDE-CODE-KICKOFF.md`).
2. Neon or Vercel Postgres: create a database, copy the `postgres://` URL.
3. Vercel: import the repo. Framework preset Next.js. Leave the Output Directory alone (Next.js default). Add env vars:
   - `DATABASE_URL`
   - `ANTHROPIC_API_KEY`
   - `FAL_KEY`
   - `APP_PASSWORD` (what you sign in with)
   - `APP_SESSION_SECRET` (any 32+ character random string)
   - `NEXT_PUBLIC_APP_NAME` (optional)
4. Deploy. The build runs `prisma db push` so the tables are created on first deploy.
5. Open the URL, sign in, paste a blurb, build the shot list.

Local: `cp .env.example .env.local`, fill it in, `npm install`, `npm run db:push`, `npm run dev`.

## House rules baked in

- No em dashes in anything generated or stored (planner instruction plus a normalizer).
- The model never renders text, logos or covers. Overlays live in the editor.
- Every render button shows its cost first. Batches are capped at 12 clips per call.
- Stills before clips. Stills are cheap to redo, clips are not.
