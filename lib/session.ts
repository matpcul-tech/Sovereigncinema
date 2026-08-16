// Stateless session cookie: `${expiresAt}.${base64url(hmac-sha256(expiresAt, secret))}`.
// Verified in middleware (Edge runtime), so this uses Web Crypto only.

export const SESSION_COOKIE = "sovereign_cinema_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64urlEncode(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function getSessionSecret(): string {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "APP_SESSION_SECRET is not set or too short (need at least 16 chars). " +
        "Generate one with `openssl rand -base64 32`.",
    );
  }
  return secret;
}

export async function signSession(ttlSeconds = SESSION_TTL_SECONDS): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await hmac(getSessionSecret(), String(expiresAt));
  return `${expiresAt}.${sig}`;
}

export async function verifySession(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  if (!expStr || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  let expected: string;
  try {
    expected = await hmac(getSessionSecret(), expStr);
  } catch {
    return false;
  }
  return timingSafeEqual(sig, expected);
}
