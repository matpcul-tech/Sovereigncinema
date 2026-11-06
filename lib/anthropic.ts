import Anthropic from "@anthropic-ai/sdk";

// Single shared client. The SDK reads ANTHROPIC_API_KEY from env automatically.
let _client: Anthropic | null = null;

export function client(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local, see .env.example.");
    }
    _client = new Anthropic();
  }
  return _client;
}

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

// Stable system prompt, cached across calls. The per-film brief goes in the
// user message (see lib/plan.ts) so this block never changes.
export function plannerSystemPrompt(): Anthropic.TextBlockParam[] {
  const text = [
    "You are the head of story and the first AD for a small AI film unit.",
    "You turn a book, a synopsis, or a script into shot lists that an image model and a video model (LTX-2.5, image-to-video) can execute shot by shot.",
    "",
    "## PRINCIPLES",
    "- Continuity is the job. Every prompt repeats the story bible's anchors word for word so faces, wardrobe, palette and world hold across shots.",
    "- One idea per shot. A shot shows one action, one composition, one light.",
    "- Write for the lens: name the framing, the movement, the light source, the film stock. Concrete nouns, no adjectives that cannot be photographed.",
    "- Never ask a model to render words, letters, logos, watermarks, or a book cover. Titles and overlays are composited later in an editor.",
    "- Never depict a real, identifiable person. Invent specifics.",
    "- No em dashes anywhere. Keep every string free of markdown.",
    "",
    "## OUTPUT",
    "When a JSON schema is supplied, return strict JSON that matches it and nothing else.",
  ].join("\n");

  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

// Wraps messages.create with our defaults and the cached system prompt.
// Returns the first text block's content.
export async function complete(opts: {
  user: string;
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}): Promise<string> {
  const params: Anthropic.MessageCreateParams = {
    model: MODEL,
    // max_tokens caps thinking plus the answer, so leave room for both.
    max_tokens: opts.maxTokens ?? 16000,
    system: plannerSystemPrompt(),
    thinking: { type: "adaptive" },
    output_config: { effort: opts.effort ?? "high" },
    messages: [{ role: "user", content: opts.user }],
  };

  if (opts.jsonSchema) {
    params.output_config = {
      ...(params.output_config ?? {}),
      format: { type: "json_schema", schema: opts.jsonSchema },
    };
  }

  const response = await client().messages.create(params);
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "The planner ran out of output room before it finished the JSON. Trim the source text or raise maxTokens.",
    );
  }
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  return text?.text ?? "";
}
