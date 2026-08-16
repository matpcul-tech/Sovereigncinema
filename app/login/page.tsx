"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { APP_NAME } from "@/lib/utils";

function isSafeRedirect(target: string | null): string {
  if (!target) return "/films";
  if (!target.startsWith("/") || target.startsWith("//")) return "/films";
  return target;
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = isSafeRedirect(params.get("next"));
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `Sign in failed (${res.status})`);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-navy-950 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <span className="w-8 h-8 rounded-sm border border-gold-500/60 flex items-center justify-center">
            <span className="w-3 h-3 rotate-45 bg-gold-500" />
          </span>
          <span className="font-display text-2xl text-ink">{APP_NAME}</span>
        </div>
        <form onSubmit={onSubmit} className="sv-card space-y-4">
          <div>
            <h1 className="font-display text-xl text-ink">Sign in</h1>
            <p className="text-sm text-navy-400 mt-1">Enter the studio password to continue.</p>
          </div>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            className="sv-input"
          />
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button type="submit" className="sv-btn-gold w-full py-3" disabled={loading || !password}>
            {loading ? "Signing in" : "Sign in"}
          </button>
          <p className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] uppercase text-teal-400">
            <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse-dot" />
            Sovereign
          </p>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
