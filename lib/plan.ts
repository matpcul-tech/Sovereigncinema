// Trailer planner. Turns a book (blurb, synopsis, or excerpt) into a shot list
// that LTX-2.5 can render shot by shot: a story bible that pins the look and
// the protagonist so every clip matches, then 7 to 9 shots with a still
// prompt, a motion prompt, a duration, and the on-screen text an editor will
// composite afterwards.
//
// The user message lives here (not in the system prompt) so the cached
// creator system prompt in lib/anthropic.ts stays stable across calls.

import { CAMERA_MOTIONS, CLIP_DURATIONS, type CameraMotion, type FilmFormat } from "./fal";

export const TRAILER_BEATS = [
  "hook",
  "world",
  "protagonist",
  "threat",
  "turn",
  "stakes",
  "title",
  "cta",
] as const;
export type TrailerBeat = (typeof TRAILER_BEATS)[number];

export type PlannedShot = {
  beat: TrailerBeat;
  label: string;
  onScreenText: string;
  imagePrompt: string;
  motionPrompt: string;
  soundNote: string;
  duration: number;
  cameraMotion: CameraMotion;
};

export type StoryBible = {
  styleAnchor: string;
  protagonistAnchor: string;
  worldAnchor: string;
  tone: string;
};

export type TrailerMusic = {
  mood: string;
  tempo: string;
  cueNotes: string;
};

export type TrailerPlan = {
  logline: string;
  storyBible: StoryBible;
  music: TrailerMusic;
  cta: string;
  shots: PlannedShot[];
};

export const SOURCE_TEXT_MAX = 14000;

export function trailerPlanPrompt(opts: {
  bookTitle: string;
  format: FilmFormat;
  sourceText: string;
  notes: string;
}): string {
  const vertical = opts.format === "9:16";
  const platformHint = vertical
    ? "vertical 9:16 for TikTok, Reels and Shorts"
    : "widescreen 16:9 for YouTube and the Amazon product page";
  const source = opts.sourceText.slice(0, SOURCE_TEXT_MAX);

  return `Plan a book trailer for "${opts.bookTitle}", ${platformHint}. Total runtime 40 to 60 seconds.

The trailer will be rendered shot by shot with an AI video model (LTX-2.5, image-to-video): for each shot we first generate one still frame from imagePrompt, then animate that frame with motionPrompt. Titles, credits and any words on screen are composited later in an editor, so nothing you write may ask the image or video model to render text, letters, logos, watermarks or a book cover.

SOURCE MATERIAL (blurb, synopsis, or excerpt):
"""
${source}
"""

CREATOR NOTES:
${opts.notes.trim() || "(none)"}

Return strict JSON matching the schema in the schema field with these rules:

storyBible (this is what keeps every shot in the same film):
- styleAnchor: one sentence that pins camera, lens, film stock, color palette, atmosphere and realism level (for example: "photoreal, 35mm anamorphic, desaturated slate and steel with sodium orange practicals, dense atmospheric haze, natural cinematic realism"). No text-related words.
- protagonistAnchor: one sentence physical description of the main character that will be repeated verbatim in every prompt where they appear: apparent age, build, hair, wardrobe, one distinguishing item. Invent specifics if the source is vague. Never a real person.
- worldAnchor: one sentence describing the setting's recurring visual elements.
- tone: three to five words.

shots: 7 to 9 shots, in this beat order: hook, world, protagonist, threat, turn, stakes, title, cta. You may drop or merge ONE of the middle beats if the story demands it. hook is always first, title then cta are always the last two.
- label: 3 to 5 words naming the shot.
- onScreenText: the words the editor will overlay, 7 words maximum, no quotation marks. For title use the book title exactly. For cta use a short call to action (for example "Read it now on Kindle Unlimited"). Empty string is allowed for shots that need no text.
- imagePrompt: one dense paragraph for a photoreal cinematic still at ${opts.format}. It MUST begin with the exact styleAnchor text, then the exact protagonistAnchor text if the character is in frame, then the composition (subject, framing, foreground and background, light, mood). Add "no text, no letters, no logos, no watermark" at the end. For title and cta shots write an atmospheric plate with negative space where text will sit.
- motionPrompt: the LTX-2.5 prompt that animates that still. Describe what moves and how across the clip, the camera move, how the light behaves, then "single continuous shot, no cuts, no captions". End with one sentence beginning "Sound:" describing diegetic sound and ambience for the clip. Do not describe a different composition from the still.
- soundNote: a short note for the editor about sound design or a music hit on this shot.
- duration: 6, 8 or 10 seconds. Keep the total between 40 and 60 seconds. Hooks and cta shots are usually 6.
- cameraMotion: one of static, dolly_in, dolly_out, dolly_left, dolly_right, jib_up, jib_down, focus_shift, or an empty string to let the motion prompt decide.

music: mood, tempo, and cueNotes telling the editor where the score should swell, drop out, or hit.

logline: 20 words maximum. cta: the closing line for the final card.

Writing rules: concrete nouns, no filler, no clickbait. Never use em dashes anywhere. Keep every string free of markdown.`;
}

export const trailerPlanSchema = {
  type: "object",
  properties: {
    logline: { type: "string" },
    storyBible: {
      type: "object",
      properties: {
        styleAnchor: { type: "string" },
        protagonistAnchor: { type: "string" },
        worldAnchor: { type: "string" },
        tone: { type: "string" },
      },
      required: ["styleAnchor", "protagonistAnchor", "worldAnchor", "tone"],
      additionalProperties: false,
    },
    music: {
      type: "object",
      properties: {
        mood: { type: "string" },
        tempo: { type: "string" },
        cueNotes: { type: "string" },
      },
      required: ["mood", "tempo", "cueNotes"],
      additionalProperties: false,
    },
    cta: { type: "string" },
    shots: {
      type: "array",
      items: {
        type: "object",
        properties: {
          beat: { type: "string" },
          label: { type: "string" },
          onScreenText: { type: "string" },
          imagePrompt: { type: "string" },
          motionPrompt: { type: "string" },
          soundNote: { type: "string" },
          duration: { type: "integer" },
          cameraMotion: { type: "string" },
        },
        required: [
          "beat",
          "label",
          "onScreenText",
          "imagePrompt",
          "motionPrompt",
          "soundNote",
          "duration",
          "cameraMotion",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["logline", "storyBible", "music", "cta", "shots"],
  additionalProperties: false,
};

// House rule: no em dashes in anything we store or show.
export function stripEmDashes(s: string): string {
  return (s ?? "")
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .trim();
}

function nearestDuration(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 6;
  let best: number = CLIP_DURATIONS[0];
  for (const d of CLIP_DURATIONS) {
    if (Math.abs(d - v) < Math.abs(best - v)) best = d;
  }
  return best;
}

function asBeat(raw: string, index: number): TrailerBeat {
  const b = (raw ?? "").toLowerCase().trim() as TrailerBeat;
  if ((TRAILER_BEATS as readonly string[]).includes(b)) return b;
  return TRAILER_BEATS[Math.min(index, TRAILER_BEATS.length - 1)];
}

function asCamera(raw: string): CameraMotion {
  const c = (raw ?? "").toLowerCase().trim() as CameraMotion;
  return CAMERA_MOTIONS.includes(c) ? c : "";
}

// Coerce whatever the model returned into a plan we can store and render.
export function normalizePlan(raw: unknown): TrailerPlan {
  const r = (raw ?? {}) as Record<string, unknown>;
  const bible = (r.storyBible ?? {}) as Record<string, string>;
  const music = (r.music ?? {}) as Record<string, string>;
  const shotsRaw = Array.isArray(r.shots) ? r.shots : [];

  const shots: PlannedShot[] = shotsRaw.slice(0, 10).map((s, i) => {
    const shot = (s ?? {}) as Record<string, unknown>;
    return {
      beat: asBeat(String(shot.beat ?? ""), i),
      label: stripEmDashes(String(shot.label ?? "")) || `Shot ${i + 1}`,
      onScreenText: stripEmDashes(String(shot.onScreenText ?? "")).replace(/["“”]/g, ""),
      imagePrompt: stripEmDashes(String(shot.imagePrompt ?? "")),
      motionPrompt: stripEmDashes(String(shot.motionPrompt ?? "")),
      soundNote: stripEmDashes(String(shot.soundNote ?? "")),
      duration: nearestDuration(Number(shot.duration ?? 6)),
      cameraMotion: asCamera(String(shot.cameraMotion ?? "")),
    };
  });

  if (shots.length === 0) {
    throw new Error("The planner returned no shots. Try adding more source text.");
  }

  return {
    logline: stripEmDashes(String(r.logline ?? "")),
    storyBible: {
      styleAnchor: stripEmDashes(bible.styleAnchor ?? ""),
      protagonistAnchor: stripEmDashes(bible.protagonistAnchor ?? ""),
      worldAnchor: stripEmDashes(bible.worldAnchor ?? ""),
      tone: stripEmDashes(bible.tone ?? ""),
    },
    music: {
      mood: stripEmDashes(music.mood ?? ""),
      tempo: stripEmDashes(music.tempo ?? ""),
      cueNotes: stripEmDashes(music.cueNotes ?? ""),
    },
    cta: stripEmDashes(String(r.cta ?? "")),
    shots,
  };
}

// The assembly sheet the editor follows in CapCut (or any NLE): shot order,
// durations, overlays, sound, music, and the closing card.
export function assemblySheet(opts: {
  title: string;
  format: FilmFormat;
  logline: string;
  music: TrailerMusic;
  cta: string;
  shots: Array<{
    order: number;
    beat: string;
    label: string;
    duration: number;
    onScreenText: string;
    soundNote: string;
    clipUrl: string;
  }>;
}): string {
  const total = opts.shots.reduce((sum, s) => sum + (s.duration || 0), 0);
  const lines: string[] = [];
  lines.push(`${opts.title} (${opts.format}) - assembly sheet`);
  lines.push(`Logline: ${opts.logline || "(none)"}`);
  lines.push(`Runtime: ${total}s across ${opts.shots.length} shots`);
  lines.push("");
  let t = 0;
  for (const s of opts.shots) {
    const start = t;
    t += s.duration || 0;
    lines.push(
      `${String(s.order + 1).padStart(2, "0")}  ${start}s to ${t}s  [${s.beat.toUpperCase()}] ${s.label}`,
    );
    lines.push(`    overlay: ${s.onScreenText || "(none)"}`);
    if (s.soundNote) lines.push(`    sound: ${s.soundNote}`);
    lines.push(`    clip: ${s.clipUrl || "(not rendered)"}`);
  }
  lines.push("");
  lines.push(`Music: ${opts.music.mood || ""}${opts.music.tempo ? `, ${opts.music.tempo}` : ""}`);
  if (opts.music.cueNotes) lines.push(`Cues: ${opts.music.cueNotes}`);
  lines.push(`Closing card: ${opts.cta || "(none)"}`);
  lines.push("");
  lines.push("Overlays, title card, cover art and music are added in the editor. Never let the generator render them.");
  return lines.join("\n");
}
