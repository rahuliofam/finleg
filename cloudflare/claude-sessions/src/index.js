// Claude Sessions API — Cloudflare Worker + D1
// Stores and retrieves Claude Code session transcripts.
// Auth: Bearer token — set via `wrangler secret put AUTH_TOKEN`

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Auth check (AUTH_TOKEN is a wrangler secret, available on env)
    const auth = request.headers.get('Authorization');
    if (auth !== `Bearer ${env.AUTH_TOKEN}`) {
      return json({ error: 'unauthorized' }, 401);
    }

    const url = new URL(request.url);

    // POST /sessions — save a session (INSERT OR REPLACE — idempotent)
    if (request.method === 'POST' && url.pathname === '/sessions') {
      const body = await request.json();
      const id = body.id || crypto.randomUUID();

      await env.DB.prepare(`
        INSERT OR REPLACE INTO sessions (id, project, model, started_at, ended_at, duration_mins, summary, transcript, token_count, cost_usd, tags)
        VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        body.project || null,
        body.model || null,
        body.started_at || null,
        body.ended_at || null,
        body.duration_mins || null,
        body.summary || null,
        body.transcript || null,
        body.token_count || null,
        body.cost_usd || null,
        body.tags || null
      ).run();

      return json({ ok: true, id });
    }

    // GET /sessions — list sessions
    if (request.method === 'GET' && url.pathname === '/sessions') {
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const project = url.searchParams.get('project');
      const search = url.searchParams.get('search');
      const dateFrom = url.searchParams.get('from');
      const dateTo = url.searchParams.get('to');

      let query = 'SELECT id, project, model, started_at, ended_at, duration_mins, summary, token_count, cost_usd, tags FROM sessions';
      let countQuery = 'SELECT COUNT(*) as total FROM sessions';
      const params = [];
      const countParams = [];
      const conditions = [];

      if (project) {
        conditions.push('project = ?');
        params.push(project);
        countParams.push(project);
      }
      if (search) {
        conditions.push('(summary LIKE ? OR transcript LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
        countParams.push(`%${search}%`, `%${search}%`);
      }
      if (dateFrom) {
        conditions.push("COALESCE(started_at, ended_at) >= ?");
        params.push(dateFrom);
        countParams.push(dateFrom);
      }
      if (dateTo) {
        conditions.push("COALESCE(started_at, ended_at) <= ?");
        params.push(dateTo + ' 23:59:59');
        countParams.push(dateTo + ' 23:59:59');
      }

      const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
      query += where + ' ORDER BY COALESCE(started_at, ended_at) DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      countQuery += where;

      const [result, countResult] = await Promise.all([
        env.DB.prepare(query).bind(...params).all(),
        env.DB.prepare(countQuery).bind(...countParams).all()
      ]);
      const total = countResult.results[0]?.total || 0;
      return json({ sessions: result.results, count: result.results.length, total, limit, offset });
    }

    // GET /sessions/:id — get full session with transcript
    if (request.method === 'GET' && url.pathname.startsWith('/sessions/')) {
      const id = url.pathname.split('/sessions/')[1];
      const result = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first();
      if (!result) return json({ error: 'not found' }, 404);
      return json(result);
    }

    // GET /projects — list distinct project names
    if (request.method === 'GET' && url.pathname === '/projects') {
      const result = await env.DB.prepare(
        'SELECT DISTINCT project FROM sessions WHERE project IS NOT NULL ORDER BY project'
      ).all();
      return json(result.results.map(r => r.project));
    }

    // GET /stats — aggregate stats (cap durations at < 1440 to exclude outliers)
    if (request.method === 'GET' && url.pathname === '/stats') {
      const result = await env.DB.prepare(`
        SELECT
          COUNT(*) as total_sessions,
          SUM(token_count) as total_tokens,
          SUM(cost_usd) as total_cost,
          SUM(CASE WHEN duration_mins < 1440 THEN duration_mins ELSE 0 END) as total_minutes,
          AVG(token_count) as avg_tokens,
          AVG(CASE WHEN duration_mins < 1440 THEN duration_mins ELSE NULL END) as avg_duration
        FROM sessions
      `).first();
      return json(result);
    }

    // POST /sessions/ask — AI-powered search using Gemini Flash
    if (request.method === 'POST' && url.pathname === '/sessions/ask') {
      const body = await request.json();
      const question = body.question;
      if (!question) return json({ error: 'question required' }, 400);

      // Build search context from provided session IDs or from keyword search
      let sessions = [];
      if (body.session_ids?.length) {
        // Use specific sessions passed from the UI
        const placeholders = body.session_ids.map(() => '?').join(',');
        const result = await env.DB.prepare(
          `SELECT id, project, model, started_at, duration_mins, summary, transcript FROM sessions WHERE id IN (${placeholders})`
        ).bind(...body.session_ids).all();
        sessions = result.results;
      } else if (body.search) {
        // Fall back to keyword search
        const result = await env.DB.prepare(
          `SELECT id, project, model, started_at, duration_mins, summary, transcript FROM sessions
           WHERE summary LIKE ? OR transcript LIKE ?
           ORDER BY COALESCE(started_at, ended_at) DESC LIMIT 20`
        ).bind(`%${body.search}%`, `%${body.search}%`).all();
        sessions = result.results;
      } else {
        // No context — search across recent sessions using summaries only
        const result = await env.DB.prepare(
          `SELECT id, project, model, started_at, duration_mins, summary FROM sessions
           ORDER BY COALESCE(started_at, ended_at) DESC LIMIT 50`
        ).bind().all();
        sessions = result.results;
      }

      if (sessions.length === 0) {
        return json({ answer: "No sessions found to search through.", session_id: null });
      }

      // Build context — use full transcripts if few sessions, summaries if many
      const useTranscripts = sessions.length <= 10;
      const sessionContext = sessions.map((s, i) => {
        const header = `[Session ${i + 1}] ID: ${s.id} | Project: ${s.project || 'unknown'} | Date: ${s.started_at || 'unknown'} | Model: ${s.model || 'unknown'} | Duration: ${s.duration_mins || '?'}min`;
        const summary = `Summary: ${s.summary || 'No summary'}`;
        if (useTranscripts && s.transcript) {
          // Truncate long transcripts to ~4K chars each
          const transcript = s.transcript.length > 4000 ? s.transcript.substring(0, 4000) + '\n... [truncated]' : s.transcript;
          return `${header}\n${summary}\nTranscript:\n${transcript}`;
        }
        return `${header}\n${summary}`;
      }).join('\n\n---\n\n');

      // Call Gemini Flash
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `You are a helpful assistant that searches through AI coding session logs. You have access to ${sessions.length} session(s) below.

Answer the user's question based on these sessions. Be specific — reference session dates, projects, and details. If you can identify a specific session that answers the question, include its ID.

If the answer isn't in the sessions, say so clearly.

SESSIONS:
${sessionContext}

USER QUESTION: ${question}

Respond in this JSON format:
{ "answer": "your answer here", "session_id": "the most relevant session ID or null", "confidence": "high|medium|low" }`
              }]
            }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 1024,
              responseMimeType: "application/json"
            }
          })
        }
      );

      if (!geminiResponse.ok) {
        const err = await geminiResponse.text();
        return json({ error: 'Gemini API error', detail: err }, 502);
      }

      const geminiData = await geminiResponse.json();
      const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

      try {
        const parsed = JSON.parse(rawText);
        return json({
          answer: parsed.answer || rawText,
          session_id: parsed.session_id || null,
          confidence: parsed.confidence || 'low',
          sessions_searched: sessions.length
        });
      } catch {
        return json({ answer: rawText, session_id: null, confidence: 'low', sessions_searched: sessions.length });
      }
    }

    // POST /fix-timestamps — repair ended_at for bulk-imported sessions
    if (request.method === 'POST' && url.pathname === '/fix-timestamps') {
      const body = await request.json();
      if (!body.import_time || !body.import_end) {
        return json({ error: 'import_time and import_end required' }, 400);
      }

      // For sessions with valid duration, set ended_at = started_at + duration
      const withDuration = await env.DB.prepare(`
        UPDATE sessions
        SET ended_at = datetime(started_at, '+' || duration_mins || ' minutes')
        WHERE ended_at BETWEEN ? AND ?
          AND started_at IS NOT NULL
          AND duration_mins IS NOT NULL
          AND duration_mins > 0
      `).bind(body.import_time, body.import_end).run();

      // For sessions without duration, set ended_at = started_at
      const withoutDuration = await env.DB.prepare(`
        UPDATE sessions
        SET ended_at = started_at
        WHERE ended_at BETWEEN ? AND ?
          AND started_at IS NOT NULL
          AND (duration_mins IS NULL OR duration_mins = 0)
      `).bind(body.import_time, body.import_end).run();

      return json({
        ok: true,
        fixed_with_duration: withDuration.meta?.changes || 0,
        fixed_without_duration: withoutDuration.meta?.changes || 0
      });
    }

    return json({ error: 'not found' }, 404);
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}
