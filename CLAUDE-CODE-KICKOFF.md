# Claude Code kickoff: Sovereign Cinema

Paste the block below into Claude Code once the repo exists (empty repo, or one you have already pushed this project into).

```
Repo: matpcul-tech/sovereign-cinema (Next.js 14 App Router, Prisma Postgres, Anthropic SDK, fal.ai).

If the repo is EMPTY: the project zip (sovereign-cinema.zip) is attached / in the working directory. Unzip it into the repo root (files at top level: package.json, app/, lib/, components/, prisma/), commit as "feat: Sovereign Cinema v0.1, trailer mode", and push to main.

If the project is ALREADY in the repo: skip that step.

Then, in the repo:
1. npm install
2. npx prisma generate
3. npm run typecheck and fix any type errors WITHOUT changing behavior. Deliver complete files, never partial snippets. Do not restyle anything: this app uses the Sovereign design system (navy #07101f, gold #d4a843, teal #00d4b8, Playfair Display + Outfit) on purpose.
4. npm run lint
5. npm run build (set DATABASE_URL to any placeholder postgres:// URL if the build complains; the real one lives in Vercel)
6. Report what changed, if anything.

Rules:
- Targeted edits only. Do not regenerate files that already pass.
- Never use em dashes anywhere in code, copy or commit messages.
- Do not add dependencies unless the build cannot pass without them.
- Do not touch prisma/schema.prisma except to fix a syntax error.
```

## After the push

Vercel: import the repo, add the env vars from `.env.example` (DATABASE_URL, ANTHROPIC_API_KEY, FAL_KEY, APP_PASSWORD, APP_SESSION_SECRET, optional NEXT_PUBLIC_APP_NAME), deploy. The build runs `prisma db push`, so the tables are created on the first deploy.

Sign in, open Films, paste the Distopia blurb, build the shot list, render stills first, then clips, then stitch.
