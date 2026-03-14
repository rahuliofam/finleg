import { createClient } from "npm:@supabase/supabase-js@2.47.10";

const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function authenticate(req: Request): boolean {
  const url = new URL(req.url);
  const headerKey = req.headers.get("x-brain-key");
  const queryKey = url.searchParams.get("key");
  return headerKey === MCP_ACCESS_KEY || queryKey === MCP_ACCESS_KEY;
}

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
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return {
      type: "observation",
      tags: [],
      people: [],
      action_items: [],
      priority: "low",
    };
  }
}

// MCP tool handlers
async function searchThoughts(query: string, threshold = 0.7, limit = 10) {
  const embedding = await generateEmbedding(query);
  const { data, error } = await supabase.rpc("match_thoughts", {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: limit,
  });
  if (error) throw error;
  return data;
}

async function browseRecent(days = 7, limit = 20) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data, error } = await supabase
    .from("thoughts")
    .select("id, content, metadata, created_at")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

async function getStats() {
  const { count } = await supabase
    .from("thoughts")
    .select("*", { count: "exact", head: true });

  const { data: recent } = await supabase
    .from("thoughts")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  const { data: oldest } = await supabase
    .from("thoughts")
    .select("created_at")
    .order("created_at", { ascending: true })
    .limit(1);

  return {
    total_thoughts: count || 0,
    newest: recent?.[0]?.created_at || null,
    oldest: oldest?.[0]?.created_at || null,
  };
}

async function captureThought(content: string, source = "mcp") {
  const [embedding, metadata] = await Promise.all([
    generateEmbedding(content),
    extractMetadata(content),
  ]);

  const { data, error } = await supabase
    .from("thoughts")
    .insert({
      content,
      embedding,
      metadata: { ...metadata, source },
    })
    .select("id, created_at")
    .single();

  if (error) throw error;
  return { id: data.id, created_at: data.created_at, metadata };
}

// MCP protocol
const TOOLS = [
  {
    name: "search_thoughts",
    description:
      "Semantic search across all captured thoughts. Returns the most relevant matches based on meaning.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to search for (natural language)",
        },
        threshold: {
          type: "number",
          description: "Similarity threshold 0-1 (default 0.7)",
        },
        limit: { type: "number", description: "Max results (default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "browse_recent",
    description: "Browse recently captured thoughts by time window.",
    inputSchema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Look back N days (default 7)",
        },
        limit: { type: "number", description: "Max results (default 20)" },
      },
    },
  },
  {
    name: "stats",
    description:
      "Get statistics about the thought database — total count, date range.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "capture_thought",
    description:
      "Capture a new thought directly into the brain. Use this to save insights, notes, decisions, or anything worth remembering.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "The thought to capture" },
        source: {
          type: "string",
          description: "Source label (default 'mcp')",
        },
      },
      required: ["content"],
    },
  },
];

Deno.serve(async (req) => {
  if (!authenticate(req)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Handle JSON-RPC requests (MCP protocol)
  if (req.method === "POST") {
    const body = await req.json();
    const { method, params, id } = body;

    let result;

    switch (method) {
      case "initialize":
        result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "open-brain", version: "1.0.0" },
        };
        break;

      case "tools/list":
        result = { tools: TOOLS };
        break;

      case "tools/call": {
        const toolName = params.name;
        const args = params.arguments || {};
        try {
          let content;
          switch (toolName) {
            case "search_thoughts":
              content = await searchThoughts(
                args.query,
                args.threshold,
                args.limit,
              );
              break;
            case "browse_recent":
              content = await browseRecent(args.days, args.limit);
              break;
            case "stats":
              content = await getStats();
              break;
            case "capture_thought":
              content = await captureThought(args.content, args.source);
              break;
            default:
              throw new Error(`Unknown tool: ${toolName}`);
          }
          result = {
            content: [
              { type: "text", text: JSON.stringify(content, null, 2) },
            ],
          };
        } catch (e) {
          result = {
            content: [{ type: "text", text: `Error: ${e.message}` }],
            isError: true,
          };
        }
        break;
      }

      case "notifications/initialized":
        return new Response(null, { status: 204 });

      default:
        result = {
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }

    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // GET — health check
  return new Response(
    JSON.stringify({
      name: "open-brain-mcp",
      version: "1.0.0",
      tools: TOOLS.map((t) => t.name),
      status: "ok",
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
