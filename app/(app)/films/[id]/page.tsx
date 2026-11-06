"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { FilmStudio, type Film } from "@/components/FilmStudio";

export default function FilmPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [film, setFilm] = useState<Film | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/films/${id}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error || `Load failed (${res.status})`);
        if (!cancelled) setFilm(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/films" className="inline-flex items-center gap-1.5 text-xs text-navy-500 hover:text-ink transition-all">
          <ArrowLeft size={14} />
          Films
        </Link>
        <div className="sv-card text-sm text-red-300">{error}</div>
      </div>
    );
  }

  if (!film) {
    return (
      <div className="flex items-center gap-2 text-sm text-navy-500">
        <Loader2 size={14} className="animate-spin" />
        Loading
      </div>
    );
  }

  return <FilmStudio key={film.id} initial={film} />;
}
