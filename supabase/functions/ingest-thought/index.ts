// Open Brain — Ingest Thought Edge Function
// Reference: https://natesnewsletter.substack.com/p/every-ai-you-use-forgets-you-heres
import { createClient } from "npm:@supabase/supabase-js@2.47.10";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INGEST_API_KEY = Deno.env.get("INGEST_API_KEY") || Deno.env.get("MCP_ACCESS_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function authenticate(req: Request): boolean {
  const headerKey = req.headers.get("x-brain-key");
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return headerKey === INGEST_API_KEY || bearerToken === INGEST_API_KEY;
}

/**
 * POST handler that captures a "thought" into the `thoughts` table with a
 * Gemini embedding + extracted metadata. Handles three entry points:
 *   - Slack URL verification handshake (unauthenticated, one-time)
 *   - Slack `event_callback` messages (filters out edits/bot/subtype events)
 *   - Direct capture via `{ content, source? }` JSON body
 * All non-handshake requests require `x-brain-key` or Bearer `INGEST_API_KEY`.
 */
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Open Brain ingest endpoint", { status: 200 });
  }

  // Slack URL verification must work without auth (Slack sends it during setup)
  // but we peek at the body first to check
  const body = await req.json();

  // Allow Slack URL verification without auth (one-time setup handshake)
  if (body.type === "url_verification") {
    return new Response(JSON.stringify({ challenge: body.challenge }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // All other requests require authentication
  if (!authenticate(req)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Handle Slack event callback
  if (body.type === "event_callback") {
    const event = body.event;

    // Only process new messages (not edits, bot messages, etc.)
    if (event.type !== "message" || event.subtype || event.bot_id) {
      return new Response("ignored", { status: 200 });
    }

    const content = event.text;

    const [embeddingResult, metadataResult] = await Promise.all([
      generateEmbedding(content),
      extractMetadata(content),
    ]);

    const { error } = await supabase.from("thoughts").insert({
      content,
      embedding: embeddingResult,
      metadata: {
        ...metadataResult,
        source: "slack",
        slack_user: event.user,
        slack_channel: event.channel,
        slack_ts: event.ts,
      },
    });

    if (error) {
      console.error("Insert error:", error);
      return new Response("insert error", { status: 500 });
    }

    return new Response("ok", { status: 200 });
  }

  // Direct capture via POST (non-Slack)
  if (body.content) {
    const [embeddingResult, metadataResult] = await Promise.all([
      generateEmbedding(body.content),
      extractMetadata(body.content),
    ]);

    const { error } = await supabase.from("thoughts").insert({
      content: body.content,
      embedding: embeddingResult,
      metadata: {
        ...metadataResult,
        source: body.source || "direct",
      },
    });

    if (error) {
      return new Response(JSON.stringify({ error }), { status: 500 });
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("no content", { status: 400 });
});

async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        outputDimensionality: 768,
      }),
    },
  );
  const data = await res.json();
  return data.embedding.values;
}

/**
 * Asks Gemini 2.0 Flash to classify the thought into `{type, tags, people,
 * action_items, priority}`. Strips markdown code fences the model sometimes
 * emits despite the "no markdown" instruction. On any error returns a safe
 * default observation so ingestion never fails because of metadata.
 */
async function extractMetadata(
  text: string,
): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Extract structured metadata from this thought. Return ONLY valid JSON, no markdown fences:\n{"type": "person_note|action_item|insight|observation|decision|question", "tags": ["category1", "category2"], "people": ["name1"], "action_items": ["task"], "priority": "high|medium|low"}\n\nThought: ${text}`,
                },
              ],
            },
          ],
          generationConfig: { temperature: 0 },
        }),
      },
    );

    const data = await res.json();
    const raw = data.candidates[0].content.parts[0].text.trim();
    // Strip markdown fences if present
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("Metadata extraction failed:", e);
    return {
      type: "observation",
      tags: [],
      people: [],
      action_items: [],
      priority: "low",
    };
  }
}
