"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clapperboard, Film, Loader2, Trash2, Sparkles } from "lucide-react";
import { relativeTime } from "@/lib/utils";

type FilmRow = {
  id: number;
  title: string;
  bookTitle: string;
  mode: string;
  format: string;
  resolution: string;
  tier: string;
  logline: string;
  finalStatus: string;
  finalUrl: string;
  updatedAt: string;
  shotCount: number;
  stillsDone: number;
  clipsDone: number;
};

export default function FilmsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<FilmRow[] | null>(null);
  const [error, setError] = useState("");

  const [bookTitle, setBookTitle] = useState("");
  const [format, setFormat] = useState<"9:16" | "16:9">("9:16");
  const [sourceText, setSourceText] = useState("");
  const [notes, setNotes] = useState("");
  const [planning, setPlanning] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/films", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `Load failed (${res.status})`);
      setRows(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (planning) return;
    setError("");
    if (!bookTitle.trim()) {
      setError("Give the book a title.");
      return;
    }
    if (sourceText.trim().length < 40) {
      setError("Paste at least a blurb so the planner has a story to work from.");
      return;
    }
    setPlanning(true);
    try {
      const res = await fetch("/api/films", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookTitle, format, sourceText, notes }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `Planning failed (${res.status})`);
      router.push(`/films/${json.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPlanning(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Delete this film and all of its shots?")) return;
    setDeleting(id);
    try {
      await fetch(`/api/films/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setDeleting(null);
    }
  }

  const canBuild = bookTitle.trim().length > 0 && sourceText.trim().length >= 40 && !planning;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl text-ink mb-1">Films</h1>
        <p className="text-navy-400">
          Books to trailers to films, shot by shot, with LTX-2.5. Paste the blurb, get a shot list, render stills then clips, stitch the cut. Trailer mode is live; continuity mode (clips that hand off frame to frame) is next.
        </p>
      </div>

      {/* New film */}
      <div className="sv-card">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={18} className="text-gold-400" />
          <h2 className="font-display text-lg text-ink">New film</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-navy-300">Book title</label>
            <input
              value={bookTitle}
              onChange={(e) => setBookTitle(e.target.value)}
              placeholder="The exact title, it becomes the title card"
              className="sv-input"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-navy-300">Format</label>
            <div className="grid grid-cols-2 rounded-md overflow-hidden border border-navy-700 bg-navy-950">
              {(["9:16", "16:9"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFormat(f)}
                  className={`py-3 text-sm font-semibold transition-all ${
                    format === f ? "bg-gold-500/20 text-gold-300" : "text-navy-400 hover:text-ink"
                  }`}
                >
                  {f}
                  <span className="block text-[10px] font-normal opacity-70">
                    {f === "9:16" ? "TikTok, Reels, Shorts" : "YouTube, Amazon"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-1.5 mt-4">
          <label className="text-sm font-medium text-navy-300">Source material</label>
          <textarea
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            rows={8}
            placeholder="Paste the back-cover blurb, a synopsis, or the first chapter. More story gives the planner better beats. Up to about 14,000 characters is read."
            className="sv-input resize-y text-sm leading-relaxed"
          />
          <div className="text-[11px] text-navy-600 text-right">{sourceText.length.toLocaleString()} chars</div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-navy-300">Direction (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Mood, what to show, what to keep off screen, a comparable film"
            className="sv-input resize-y text-sm"
          />
        </div>

        {error ? <p className="text-sm text-red-400 mt-3">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <button
            onClick={create}
            disabled={!canBuild}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-gold-500 text-navy-950 text-sm font-semibold hover:bg-gold-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {planning ? <Loader2 size={16} className="animate-spin" /> : <Clapperboard size={16} />}
            {planning ? "Planning shots" : "Build shot list"}
          </button>
          <span className="text-xs text-navy-500">
            {planning ? "Claude is writing the story bible and 7 to 9 shots. About 30 to 60 seconds." : "Planning is text only. Nothing renders until you say so."}
          </span>
        </div>
      </div>

      {/* Existing */}
      <div className="space-y-3">
        <h2 className="font-display text-lg text-ink">Your films</h2>
        {rows === null ? (
          <div className="text-sm text-navy-500 flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" />
            Loading
          </div>
        ) : rows.length === 0 ? (
          <div className="sv-card text-sm text-navy-400">
            Nothing here yet. Paste a blurb above and build the first shot list.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {rows.map((t) => (
              <div key={t.id} className="sv-card p-5 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/films/${t.id}`} className="text-base font-semibold text-ink hover:text-gold-300 transition-all block truncate">
                      {t.title}
                    </Link>
                    <p className="text-xs text-navy-500 mt-0.5 line-clamp-2">{t.logline || t.bookTitle}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="sv-chip">{t.mode}</span>
                    <span className="sv-chip">{t.format}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-navy-400">
                  <span>{t.shotCount} shots</span>
                  <span>stills {t.stillsDone}/{t.shotCount}</span>
                  <span>clips {t.clipsDone}/{t.shotCount}</span>
                  {t.finalStatus === "completed" && t.finalUrl ? (
                    <span className="inline-flex items-center gap-1 text-teal-400">
                      <Film size={12} />
                      cut ready
                    </span>
                  ) : null}
                  <span className="text-navy-600 ml-auto">{relativeTime(t.updatedAt)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/films/${t.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gold-500/15 text-gold-300 border border-gold-500/25 hover:bg-gold-500/25 transition-all"
                  >
                    <Clapperboard size={12} />
                    Open studio
                  </Link>
                  <button
                    onClick={() => remove(t.id)}
                    disabled={deleting === t.id}
                    className="inline-flex items-center gap-1 text-xs text-navy-500 hover:text-red-300 transition-all ml-auto disabled:opacity-40"
                  >
                    {deleting === t.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
