import { createClient } from "npm:@supabase/supabase-js@2.47.10";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  // Slack sends URL verification challenge on setup
  if (req.method === "POST") {
    const body = await req.json();

    // Handle Slack URL verification
    if (body.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Handle Slack event callback
    if (body.type === "event_callback") {
      const event = body.event;

      // Only process new messages (not edits, bot messages, etc.)
      if (
        event.type !== "message" ||
        event.subtype ||
        event.bot_id
      ) {
        return new Response("ignored", { status: 200 });
      }

      const content = event.text;
      const user = event.user;
      const channel = event.channel;
      const ts = event.ts;

      // Generate embedding and extract metadata in parallel
      const [embeddingResult, metadataResult] = await Promise.all([
        generateEmbedding(content),
        extractMetadata(content),
      ]);

      // Insert into thoughts table
      const { error } = await supabase.from("thoughts").insert({
        content,
        embedding: embeddingResult,
        metadata: {
          ...metadataResult,
          source: "slack",
          slack_user: user,
          slack_channel: channel,
          slack_ts: ts,
        },
      });

      if (error) {
        console.error("Insert error:", error);
        return new Response("insert error", { status: 500 });
      }

      return new Response("ok", { status: 200 });
    }
  }

  // Direct capture via POST (non-Slack)
  if (req.method === "POST") {
    try {
      const body = await req.json();
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
    } catch {
      // Not JSON or no content field — fall through
    }
  }

  return new Response("Open Brain ingest endpoint", { status: 200 });
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

async function extractMetadata(
  text: string,
): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                'Extract structured metadata from this thought. Return ONLY valid JSON, no markdown:\n{\n  "type": "person_note|action_item|insight|observation|decision|question",\n  "tags": ["category1", "category2"],\n  "people": ["name1"],\n  "action_items": ["task"],\n  "priority": "high|medium|low"\n}',
            },
            { role: "user", content: text },
          ],
          temperature: 0,
        }),
      },
    );

    const data = await res.json();
    const raw = data.choices[0].message.content.trim();
    return JSON.parse(raw);
  } catch (e) {
    console.error("Metadata extraction failed:", e);
    return { type: "observation", tags: [], people: [], action_items: [], priority: "low" };
  }
}
