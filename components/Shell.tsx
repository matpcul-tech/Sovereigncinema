"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

// Top bar. Mobile first: the whole app is one column under this bar.
// The sovereign indicator stays visible on every screen.
export function Shell({ appName, children }: { appName: string; children: React.ReactNode }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen bg-navy-950">
      <header className="sticky top-0 z-20 bg-navy-950/95 border-b border-gold-500/15">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-14 flex items-center justify-between gap-3">
          <Link href="/films" className="flex items-center gap-3 min-w-0">
            <span className="w-7 h-7 rounded-sm border border-gold-500/60 flex items-center justify-center shrink-0">
              <span className="w-2.5 h-2.5 rotate-45 bg-gold-500" />
            </span>
            <span className="font-display text-lg text-ink truncate">{appName}</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] uppercase text-teal-400">
              <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse-dot" />
              Sovereign
            </span>
            <button
              onClick={signOut}
              disabled={signingOut}
              className="text-navy-400 hover:text-ink transition-all disabled:opacity-50"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8">{children}</main>
    </div>
  );
}
