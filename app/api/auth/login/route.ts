import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession } from "@/lib/session";
import { clientIp, rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(`login:${clientIp(req)}`, 5, 60);
  if (!limit.ok) return rateLimitResponse(limit);

  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { error: "APP_PASSWORD is not configured on the server." },
      { status: 500 },
    );
  }

  let password = "";
  try {
    const body = await req.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!password || !timingSafeEqual(password, expected)) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const token = await signSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}
