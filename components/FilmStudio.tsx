"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clapperboard,
  Copy,
  Download,
  Film,
  Image as ImageIcon,
  Link as LinkIcon,
  Loader2,
  RefreshCw,
  Scissors,
  Trash2,
  Wand2,
} from "lucide-react";
import { parseJSON } from "@/lib/utils";
import {
  CAMERA_MOTIONS,
  CLIP_DURATIONS,
  CLIP_PRICE_PER_SECOND,
  IMAGE_PRICE_EST,
  type CameraMotion,
  type ClipResolution,
  type ClipTier,
  type FilmFormat,
} from "@/lib/fal";
import { assemblySheet, type StoryBible, type TrailerMusic } from "@/lib/plan";

export type Shot = {
  id: number;
  order: number;
  beat: string;
  label: string;
  onScreenText: string;
  imagePrompt: string;
  motionPrompt: string;
  soundNote: string;
  duration: number;
  cameraMotion: string;
  imageUrl: string;
  imageStatus: string;
  clipUrl: string;
  clipStatus: string;
  error: string;
  approved: boolean;
};

export type Film = {
  id: number;
  title: string;
  bookTitle: string;
  format: string;
  resolution: string;
  tier: string;
  sourceText: string;
  notes: string;
  logline: string;
  storyBible: string;
  music: string;
  cta: string;
  finalStatus: string;
  finalUrl: string;
  finalError: string;
  shots: Shot[];
};

type ShotDraft = {
  imagePrompt: string;
  motionPrompt: string;
  onScreenText: string;
  imageUrlInput: string;
};

const inFlight = (s: string) => s === "queued" || s === "generating";

const CAMERA_LABELS: Record<CameraMotion, string> = {
  "": "Let the prompt decide",
  static: "Static",
  dolly_in: "Dolly in",
  dolly_out: "Dolly out",
  dolly_left: "Dolly left",
  dolly_right: "Dolly right",
  jib_up: "Jib up",
  jib_down: "Jib down",
  focus_shift: "Focus shift",
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function draftsFrom(shots: Shot[]): Record<number, ShotDraft> {
  const out: Record<number, ShotDraft> = {};
  for (const s of shots) {
    out[s.id] = {
      imagePrompt: s.imagePrompt,
      motionPrompt: s.motionPrompt,
      onScreenText: s.onScreenText,
      imageUrlInput: "",
    };
  }
  return out;
}

export function FilmStudio({ initial }: { initial: Film }) {
  const router = useRouter();
  const [film, setFilm] = useState<Film>(initial);
  const [drafts, setDrafts] = useState<Record<number, ShotDraft>>(() => draftsFrom(initial.shots));
  const [busy, setBusy] = useState<string>(""); // which action is running
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [notes, setNotes] = useState(initial.notes);
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const format = (film.format === "16:9" ? "16:9" : "9:16") as FilmFormat;
  const resolution = (film.resolution === "720p" ? "720p" : "1080p") as ClipResolution;
  const tier = (film.tier === "pro" ? "pro" : "fast") as ClipTier;
  const bible = useMemo(
    () => parseJSON<StoryBible>(film.storyBible, { styleAnchor: "", protagonistAnchor: "", worldAnchor: "", tone: "" }),
    [film.storyBible],
  );
  const music = useMemo(
    () => parseJSON<TrailerMusic>(film.music, { mood: "", tempo: "", cueNotes: "" }),
    [film.music],
  );

  const shots = film.shots;
  const runtime = shots.reduce((sum, s) => sum + (s.duration || 0), 0);
  const stillsDone = shots.filter((s) => !!s.imageUrl).length;
  const clipsDone = shots.filter((s) => s.clipStatus === "completed" && !!s.clipUrl).length;
  const approvedCount = shots.filter((s) => s.approved && s.clipStatus === "completed").length;
  const anyInFlight =
    shots.some((s) => inFlight(s.imageStatus) || inFlight(s.clipStatus)) || inFlight(film.finalStatus);

  const pendingStills = shots.filter((s) => !s.imageUrl && !inFlight(s.imageStatus));
  const pendingClips = shots.filter((s) => !!s.imageUrl && s.clipStatus !== "completed" && !inFlight(s.clipStatus));
  const pricePerSecond = CLIP_PRICE_PER_SECOND[tier][resolution];
  const pendingClipCost = pendingClips.reduce((sum, s) => sum + s.duration * pricePerSecond, 0);
  const allClipCost = shots.reduce((sum, s) => sum + s.duration * pricePerSecond, 0);

  // Polling: while anything is queued or generating, refresh every 4s.
  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/films/${film.id}/status`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok && json?.id) setFilm(json);
    } catch {
      // network hiccup: try again on the next tick
    }
  }, [film.id]);

  useEffect(() => {
    if (!anyInFlight) return;
    pollTimer.current = setTimeout(poll, 4000);
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [anyInFlight, film, poll]);

  function flash(kind: "ok" | "err", text: string) {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), kind === "ok" ? 3500 : 8000);
  }

  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      flash("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function generate(kind: "image" | "clip", shotIds?: number[], force?: boolean) {
    await run(`${kind}:${shotIds?.join(",") ?? "all"}`, async () => {
      const res = await fetch(`/api/films/${film.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, shotIds, force }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `Request failed (${res.status})`);
      if (json.film) setFilm(json.film);
      const failed: Array<{ error?: string }> = json.failed ?? [];
      if (failed.length) {
        flash("err", `${json.submitted} submitted, ${failed.length} failed: ${failed[0]?.error ?? ""}`);
      } else {
        flash(
          "ok",
          kind === "clip"
            ? `${json.submitted} clip${json.submitted === 1 ? "" : "s"} rendering, about ${money(json.estimatedCost ?? 0)}`
            : `${json.submitted} still${json.submitted === 1 ? "" : "s"} rendering`,
        );
      }
    });
  }

  async function saveShot(shotId: number, patch: Partial<Shot> & { imageUrl?: string }) {
    const res = await fetch(`/api/films/${film.id}/shots/${shotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      flash("err", json.error || `Save failed (${res.status})`);
      return;
    }
    setFilm((t) => ({ ...t, shots: t.shots.map((s) => (s.id === shotId ? { ...s, ...json } : s)) }));
  }

  async function saveSettings(patch: Record<string, unknown>) {
    const res = await fetch(`/api/films/${film.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok || json.error) {
      flash("err", json.error || `Save failed (${res.status})`);
      return;
    }
    setFilm(json);
  }

  async function rebuild() {
    const ok = window.confirm(
      "Rebuild the shot list? Every shot, still and clip on this film will be replaced.",
    );
    if (!ok) return;
    await run("rebuild", async () => {
      const res = await fetch(`/api/films/${film.id}/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `Rebuild failed (${res.status})`);
      setFilm(json);
      setDrafts(draftsFrom(json.shots ?? []));
      flash("ok", `New shot list: ${json.shots?.length ?? 0} shots`);
    });
  }

  async function stitch() {
    await run("stitch", async () => {
      const res = await fetch(`/api/films/${film.id}/stitch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedOnly }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `Stitch failed (${res.status})`);
      if (json.film) setFilm(json.film);
      flash("ok", `Stitching ${json.clips} clips`);
    });
  }

  async function removeShot(shotId: number) {
    if (!window.confirm("Remove this shot from the film?")) return;
    await run(`remove:${shotId}`, async () => {
      const res = await fetch(`/api/films/${film.id}/shots/${shotId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Remove failed (${res.status})`);
      await poll();
    });
  }

  async function deleteFilm() {
    if (!window.confirm("Delete this film and all of its shots?")) return;
    await run("delete", async () => {
      await fetch(`/api/films/${film.id}`, { method: "DELETE" });
      router.push("/films");
      router.refresh();
    });
  }

  async function copySheet() {
    const text = assemblySheet({
      title: film.title,
      format,
      logline: film.logline,
      music,
      cta: film.cta,
      shots: shots.map((s) => ({
        order: s.order,
        beat: s.beat,
        label: s.label,
        duration: s.duration,
        onScreenText: s.onScreenText,
        soundNote: s.soundNote,
        clipUrl: s.clipUrl,
      })),
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      flash("err", "Clipboard blocked by the browser. Long-press the sheet text to copy it.");
    }
  }

  function setDraft(shotId: number, patch: Partial<ShotDraft>) {
    setDrafts((d) => ({ ...d, [shotId]: { ...(d[shotId] ?? { imagePrompt: "", motionPrompt: "", onScreenText: "", imageUrlInput: "" }), ...patch } }));
  }

  function commitDraft(shot: Shot, field: "imagePrompt" | "motionPrompt" | "onScreenText") {
    const value = drafts[shot.id]?.[field];
    if (value === undefined || value === shot[field]) return;
    void saveShot(shot.id, { [field]: value } as Partial<Shot>);
  }

  function scrollToShot(id: number) {
    document.getElementById(`shot-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const frameAspect = format === "9:16" ? "aspect-[9/16]" : "aspect-video";

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <Link
          href="/films"
          className="inline-flex items-center gap-1.5 text-xs text-navy-500 hover:text-ink transition-all w-fit"
        >
          <ArrowLeft size={14} />
          Films
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-2xl md:text-3xl text-ink leading-tight">{film.title}</h1>
            <p className="text-navy-400 text-sm mt-1">{film.logline || film.bookTitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="sv-chip">{format}</span>
            <span className="sv-chip">{resolution}</span>
            <span className="sv-chip">LTX-2.5 {tier}</span>
          </div>
        </div>
      </div>

      {notice ? (
        <div
          className={`rounded-md px-4 py-3 text-sm border ${
            notice.kind === "ok"
              ? "bg-teal-500/10 border-teal-500/25 text-teal-300"
              : "bg-red-500/10 border-red-500/20 text-red-300"
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      {/* Filmstrip rail: the whole film at a glance */}
      <div className="sv-card p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Clapperboard size={16} className="text-gold-400" />
            <span className="font-display text-base text-ink">Filmstrip</span>
            <span className="text-xs text-navy-500">
              {shots.length} shots, {runtime}s
            </span>
          </div>
          <div className="text-xs text-navy-400">
            stills {stillsDone}/{shots.length}, clips {clipsDone}/{shots.length}
            {clipsDone < shots.length ? (
              <span className="text-navy-600"> , full render about {money(allClipCost)}</span>
            ) : null}
          </div>
        </div>
        <div className="h-2 rounded-t bg-[repeating-linear-gradient(90deg,transparent_0_8px,rgba(212,168,67,0.28)_8px_14px)]" />
        <div className="flex gap-2 overflow-x-auto py-2 px-1 bg-navy-950/60 border-y border-navy-800/60">
          {shots.map((s, i) => {
            const state = inFlight(s.imageStatus) || inFlight(s.clipStatus)
              ? "busy"
              : s.clipStatus === "completed" && s.clipUrl
                ? "clip"
                : s.imageUrl
                  ? "still"
                  : s.imageStatus === "failed" || s.clipStatus === "failed"
                    ? "failed"
                    : "empty";
            const ring =
              state === "clip"
                ? "border-teal-400/70"
                : state === "busy"
                  ? "border-gold-400 animate-pulse"
                  : state === "still"
                    ? "border-gold-500/40"
                    : state === "failed"
                      ? "border-red-500/60"
                      : "border-navy-700";
            const w = format === "9:16" ? "w-14" : "w-24";
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollToShot(s.id)}
                title={`${i + 1}. ${s.label}`}
                className={`${w} shrink-0 ${frameAspect} rounded-md border-2 ${ring} bg-navy-900 overflow-hidden relative focus:outline-none focus:ring-2 focus:ring-gold-500/50`}
              >
                {s.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] uppercase tracking-wider text-navy-500 px-1 text-center">
                    {s.beat}
                  </span>
                )}
                <span className="absolute bottom-0.5 right-0.5 text-[9px] font-semibold text-ink bg-navy-950/80 rounded px-1">
                  {s.duration}s
                </span>
              </button>
            );
          })}
        </div>
        <div className="h-2 rounded-b bg-[repeating-linear-gradient(90deg,transparent_0_8px,rgba(212,168,67,0.28)_8px_14px)]" />

        <div className="flex flex-wrap gap-2 mt-4">
          <button
            onClick={() => generate("image")}
            disabled={!!busy || pendingStills.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-navy-800 border border-navy-700 text-ink text-sm font-semibold hover:border-gold-500/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy === "image:all" ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
            Render {pendingStills.length || ""} still{pendingStills.length === 1 ? "" : "s"}
            <span className="text-navy-500 font-normal">about {money(pendingStills.length * IMAGE_PRICE_EST)}</span>
          </button>
          <button
            onClick={() => generate("clip")}
            disabled={!!busy || pendingClips.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-gold-500 text-navy-950 text-sm font-semibold hover:bg-gold-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy === "clip:all" ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
            Render {pendingClips.length || ""} clip{pendingClips.length === 1 ? "" : "s"}
            <span className="text-navy-950/70 font-normal">about {money(pendingClipCost)}</span>
          </button>
          <button
            onClick={stitch}
            disabled={!!busy || clipsDone < 2 || inFlight(film.finalStatus)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-navy-800 border border-navy-700 text-ink text-sm font-semibold hover:border-gold-500/40 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy === "stitch" || inFlight(film.finalStatus) ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Scissors size={14} />
            )}
            Stitch cut
          </button>
          {approvedCount > 0 ? (
            <label className="inline-flex items-center gap-2 text-xs text-navy-400 px-2">
              <input
                type="checkbox"
                checked={approvedOnly}
                onChange={(e) => setApprovedOnly(e.target.checked)}
                className="accent-gold-500"
              />
              approved clips only ({approvedCount})
            </label>
          ) : null}
        </div>
        {shots.length > 0 && stillsDone === 0 ? (
          <p className="text-xs text-navy-500 mt-3">
            Order of work: render stills, check they match the story bible, then render clips. Stills are cheap to redo, clips are not.
          </p>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Shots */}
        <div className="space-y-4 min-w-0">
          {shots.map((s, i) => {
            const d = drafts[s.id] ?? { imagePrompt: s.imagePrompt, motionPrompt: s.motionPrompt, onScreenText: s.onScreenText, imageUrlInput: "" };
            const stillBusy = inFlight(s.imageStatus);
            const clipBusy = inFlight(s.clipStatus);
            const clipDone = s.clipStatus === "completed" && !!s.clipUrl;
            return (
              <div key={s.id} id={`shot-${s.id}`} className="sv-card p-4 md:p-5 scroll-mt-4">
                {/* Slate */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-300 bg-gold-500/10 border border-gold-500/25 rounded-sm px-1.5 py-0.5">
                      {i + 1} {s.beat}
                    </span>
                    <span className="text-sm font-semibold text-ink truncate">{s.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={s.duration}
                      onChange={(e) => saveShot(s.id, { duration: Number(e.target.value) })}
                      className="sv-input !w-auto !py-1.5 !px-2 text-xs"
                      title="Clip length"
                    >
                      {CLIP_DURATIONS.map((n) => (
                        <option key={n} value={n}>
                          {n}s
                        </option>
                      ))}
                    </select>
                    <select
                      value={s.cameraMotion}
                      onChange={(e) => saveShot(s.id, { cameraMotion: e.target.value })}
                      className="sv-input !w-auto !py-1.5 !px-2 text-xs"
                      title="Camera move"
                    >
                      {CAMERA_MOTIONS.map((c) => (
                        <option key={c || "auto"} value={c}>
                          {CAMERA_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className={`grid gap-4 ${format === "9:16" ? "md:grid-cols-[200px_minmax(0,1fr)]" : "md:grid-cols-[280px_minmax(0,1fr)]"}`}>
                  {/* Frame */}
                  <div className="space-y-2">
                    <div className={`${frameAspect} w-full rounded-md overflow-hidden bg-navy-900 border border-navy-700/60 relative`}>
                      {clipDone ? (
                        <video
                          src={s.clipUrl}
                          controls
                          playsInline
                          preload="metadata"
                          poster={s.imageUrl || undefined}
                          className="w-full h-full object-cover bg-black"
                        />
                      ) : s.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={s.imageUrl} alt={s.label} className="w-full h-full object-cover" />
                      ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-navy-600">
                          <ImageIcon size={22} />
                          <span className="text-[11px] uppercase tracking-wider">no still yet</span>
                        </div>
                      )}
                      {stillBusy || clipBusy ? (
                        <div className="absolute inset-0 bg-navy-950/60 flex items-center justify-center">
                          <div className="flex items-center gap-2 text-xs text-ink">
                            <Loader2 size={14} className="animate-spin text-gold-400" />
                            {clipBusy
                              ? s.clipStatus === "queued"
                                ? "Queued at fal"
                                : "Rendering clip"
                              : s.imageStatus === "queued"
                                ? "Queued at fal"
                                : "Rendering still"}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => generate("image", [s.id], true)}
                        disabled={!!busy || stillBusy || clipBusy}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-navy-800 text-navy-300 hover:text-ink transition-all disabled:opacity-40"
                      >
                        {s.imageUrl ? <RefreshCw size={12} /> : <ImageIcon size={12} />}
                        {s.imageUrl ? "Redo still" : "Render still"}
                      </button>
                      <button
                        onClick={() => generate("clip", [s.id], true)}
                        disabled={!!busy || !s.imageUrl || stillBusy || clipBusy}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gold-500/15 text-gold-300 border border-gold-500/25 hover:bg-gold-500/25 transition-all disabled:opacity-40"
                        title={!s.imageUrl ? "Render a still first" : `about ${money(s.duration * pricePerSecond)}`}
                      >
                        {clipDone ? <RefreshCw size={12} /> : <Film size={12} />}
                        {clipDone ? "Redo clip" : "Render clip"}
                        <span className="text-gold-400/70">{money(s.duration * pricePerSecond)}</span>
                      </button>
                      {clipDone ? (
                        <>
                          <a
                            href={s.clipUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-navy-800 text-navy-300 hover:text-ink transition-all"
                          >
                            <Download size={12} />
                            MP4
                          </a>
                          <button
                            onClick={() => saveShot(s.id, { approved: !s.approved })}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                              s.approved
                                ? "bg-teal-500/15 text-teal-300 border border-teal-500/40"
                                : "bg-navy-800/60 text-navy-300 hover:text-ink"
                            }`}
                          >
                            <Check size={12} />
                            {s.approved ? "Approved" : "Approve"}
                          </button>
                        </>
                      ) : null}
                    </div>

                    {s.imageStatus === "failed" || s.clipStatus === "failed" ? (
                      <div className="flex items-start gap-1.5 text-xs text-red-300">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                        <span>{s.error || "Render failed."}</span>
                      </div>
                    ) : null}
                  </div>

                  {/* Prompts */}
                  <div className="space-y-3 min-w-0">
                    <div>
                      <label className="sv-eyebrow">
                        Overlay text (added in the editor)
                      </label>
                      <input
                        value={d.onScreenText}
                        onChange={(e) => setDraft(s.id, { onScreenText: e.target.value })}
                        onBlur={() => commitDraft(s, "onScreenText")}
                        placeholder="none"
                        className="sv-input !py-2 text-sm mt-1"
                      />
                    </div>
                    <div>
                      <label className="sv-eyebrow">
                        Still prompt
                      </label>
                      <textarea
                        value={d.imagePrompt}
                        onChange={(e) => setDraft(s.id, { imagePrompt: e.target.value })}
                        onBlur={() => commitDraft(s, "imagePrompt")}
                        rows={4}
                        className="sv-input !py-2 text-xs leading-relaxed mt-1 resize-y"
                      />
                    </div>
                    <div>
                      <label className="sv-eyebrow">
                        Motion prompt (LTX-2.5)
                      </label>
                      <textarea
                        value={d.motionPrompt}
                        onChange={(e) => setDraft(s.id, { motionPrompt: e.target.value })}
                        onBlur={() => commitDraft(s, "motionPrompt")}
                        rows={4}
                        className="sv-input !py-2 text-xs leading-relaxed mt-1 resize-y"
                      />
                    </div>
                    {s.soundNote ? (
                      <p className="text-xs text-navy-500">
                        <span className="text-navy-400">Sound:</span> {s.soundNote}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex-1 min-w-[180px] flex items-center gap-2">
                        <LinkIcon size={12} className="text-navy-500 shrink-0" />
                        <input
                          value={d.imageUrlInput}
                          onChange={(e) => setDraft(s.id, { imageUrlInput: e.target.value })}
                          placeholder="or paste your own image URL"
                          className="sv-input !py-1.5 text-xs"
                        />
                        <button
                          onClick={() => {
                            const url = d.imageUrlInput.trim();
                            if (!url) return;
                            void saveShot(s.id, { imageUrl: url });
                            setDraft(s.id, { imageUrlInput: "" });
                          }}
                          disabled={!d.imageUrlInput.trim()}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-navy-800 text-navy-300 hover:text-ink transition-all disabled:opacity-40"
                        >
                          Use
                        </button>
                      </div>
                      <button
                        onClick={() => removeShot(s.id)}
                        disabled={!!busy}
                        className="inline-flex items-center gap-1 text-xs text-navy-500 hover:text-red-300 transition-all ml-auto"
                      >
                        <Trash2 size={12} />
                        Remove shot
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          {/* Final cut */}
          <div className="sv-card p-4 md:p-5">
            <div className="flex items-center gap-2 mb-3">
              <Scissors size={16} className="text-gold-400" />
              <h2 className="font-display text-base text-ink">Stitched cut</h2>
            </div>
            {film.finalStatus === "completed" && film.finalUrl ? (
              <div className="space-y-2">
                <video
                  src={film.finalUrl}
                  controls
                  playsInline
                  preload="metadata"
                  className={`w-full rounded-md bg-black border border-navy-700/40 ${format === "9:16" ? "max-h-[420px]" : ""}`}
                />
                <a
                  href={film.finalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-navy-800 text-navy-300 hover:text-ink transition-all"
                >
                  <Download size={12} />
                  Download cut
                </a>
                <p className="text-xs text-navy-500">
                  Drop this into CapCut, add the title card, cover, overlays and your score. Native clip audio is in the file.
                </p>
              </div>
            ) : inFlight(film.finalStatus) ? (
              <div className="flex items-center gap-2 text-sm text-navy-300">
                <Loader2 size={14} className="animate-spin text-gold-400" />
                {film.finalStatus === "queued" ? "Queued at fal" : "Joining clips"}
              </div>
            ) : film.finalStatus === "failed" ? (
              <div className="flex items-start gap-2 text-xs text-red-300">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span>{film.finalError || "Stitch failed."}</span>
              </div>
            ) : (
              <p className="text-xs text-navy-500">
                {clipsDone < 2
                  ? "Render at least two clips, then stitch them into one file in shot order."
                  : `${clipsDone} clips ready. Stitch runs free on fal and takes under a minute.`}
              </p>
            )}
          </div>

          {/* Assembly sheet */}
          <div className="sv-card p-4 md:p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <Wand2 size={16} className="text-gold-400" />
                <h2 className="font-display text-base text-ink">Assembly sheet</h2>
              </div>
              <button
                onClick={copySheet}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-navy-800 text-navy-300 hover:text-ink transition-all"
              >
                {copied ? <Check size={12} className="text-teal-400" /> : <Copy size={12} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <ol className="space-y-1.5">
              {shots.map((s, i) => (
                <li key={s.id} className="text-xs text-navy-300 flex gap-2">
                  <span className="text-navy-600 tabular-nums w-5 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0">
                    <span className="text-navy-500">{s.duration}s </span>
                    {s.onScreenText ? <span className="text-ink">{s.onScreenText}</span> : <span className="text-navy-600">no overlay</span>}
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-3 pt-3 border-t border-navy-800/60 space-y-1 text-xs text-navy-400">
              <p>
                <span className="text-navy-500">Music: </span>
                {music.mood || "(none)"}
                {music.tempo ? `, ${music.tempo}` : ""}
              </p>
              {music.cueNotes ? (
                <p>
                  <span className="text-navy-500">Cues: </span>
                  {music.cueNotes}
                </p>
              ) : null}
              <p>
                <span className="text-navy-500">Closing card: </span>
                {film.cta || "(none)"}
              </p>
            </div>
          </div>

          {/* Story bible */}
          <div className="sv-card p-4 md:p-5">
            <h2 className="text-sm font-semibold text-ink mb-3">Story bible</h2>
            <dl className="space-y-2 text-xs">
              <div>
                <dt className="text-navy-500 uppercase tracking-wider text-[10px]">Style</dt>
                <dd className="text-navy-300">{bible.styleAnchor || "(none)"}</dd>
              </div>
              <div>
                <dt className="text-navy-500 uppercase tracking-wider text-[10px]">Protagonist</dt>
                <dd className="text-navy-300">{bible.protagonistAnchor || "(none)"}</dd>
              </div>
              <div>
                <dt className="text-navy-500 uppercase tracking-wider text-[10px]">World</dt>
                <dd className="text-navy-300">{bible.worldAnchor || "(none)"}</dd>
              </div>
              <div>
                <dt className="text-navy-500 uppercase tracking-wider text-[10px]">Tone</dt>
                <dd className="text-navy-300">{bible.tone || "(none)"}</dd>
              </div>
            </dl>
            <p className="text-[11px] text-navy-600 mt-3">
              Every still prompt opens with these anchors so the shots read as one film. Edit a shot's prompt if a frame drifts.
            </p>
          </div>

          {/* Setup */}
          <div className="sv-card p-4 md:p-5 space-y-3">
            <h2 className="font-display text-base text-ink">Setup</h2>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="sv-eyebrow">Format</label>
                <select
                  value={format}
                  onChange={(e) => saveSettings({ format: e.target.value })}
                  className="sv-input !py-1.5 !px-2 text-xs mt-1"
                >
                  <option value="9:16">9:16</option>
                  <option value="16:9">16:9</option>
                </select>
              </div>
              <div>
                <label className="sv-eyebrow">Res</label>
                <select
                  value={resolution}
                  onChange={(e) => saveSettings({ resolution: e.target.value })}
                  className="sv-input !py-1.5 !px-2 text-xs mt-1"
                >
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </select>
              </div>
              <div>
                <label className="sv-eyebrow">Tier</label>
                <select
                  value={tier}
                  onChange={(e) => saveSettings({ tier: e.target.value })}
                  className="sv-input !py-1.5 !px-2 text-xs mt-1"
                >
                  <option value="fast">Fast</option>
                  <option value="pro">Pro</option>
                </select>
              </div>
            </div>
            <p className="text-[11px] text-navy-600">
              {money(pricePerSecond)}/s at {resolution} {tier}. Draft at 720p fast, final at 1080p. Changing format after stills exist means redoing the stills.
            </p>
            <div>
              <label className="sv-eyebrow">
                Direction for the planner
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="What the film should feel like, what to show, what to avoid"
                className="sv-input !py-2 text-xs mt-1 resize-y"
              />
            </div>
            <button
              onClick={rebuild}
              disabled={!!busy}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-navy-800 border border-navy-700 text-ink text-xs font-semibold hover:border-gold-500/40 transition-all disabled:opacity-40 w-full justify-center"
            >
              {busy === "rebuild" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Rebuild shot list
            </button>
            <button
              onClick={deleteFilm}
              disabled={!!busy}
              className="inline-flex items-center gap-1.5 text-xs text-navy-500 hover:text-red-300 transition-all"
            >
              <Trash2 size={12} />
              Delete film
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
