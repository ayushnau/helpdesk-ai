import dotenv from "dotenv";
dotenv.config();

import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  agentTurn,
  agentTurnStream,
  getOrCreateSession,
  saveSession,
  deleteSession,
  getTenantConfig,
  getDailyTokenUsage,
  logTokenUsage,
  sessionCount,
  ensureSchema,
  closeConnections,
  provider,
  providerFromClientKey,
  getRedis,
  invalidateTenantCache,
} from "@helpdesk-ai/agent-core";
import pg from "pg";

// ── Hono app with typed variables ───────────────────────────────────────────

type Variables = {
  tenantId: string;
  sessionId: string;
};

const app = new Hono<{ Variables: Variables }>();

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:3000").split(",");

app.use("/*", cors({
  origin: ALLOWED_ORIGINS,
}));

// ── Middleware: extract tenant + session from headers ────────────────────────

app.use("/chat/*", async (c, next) => {
  const tenantId = c.req.header("X-Tenant-ID");
  const sessionId = c.req.header("X-Session-ID");

  if (!tenantId || !sessionId) {
    return c.json(
      { error: "Missing X-Tenant-ID or X-Session-ID header" },
      400,
    );
  }

  // Check tenant exists
  const config = await getTenantConfig(tenantId);
  if (!config) {
    return c.json({ error: `Unknown tenant: ${tenantId}` }, 404);
  }

  c.set("tenantId", tenantId);
  c.set("sessionId", sessionId);

  await next();
});

// ── POST /chat — send a message, get a response ────────────────────────────

app.post("/chat", async (c) => {
  const tenantId = c.get("tenantId");
  const sessionId = c.get("sessionId");

  const body = await c.req.json<{ message?: string }>();
  if (!body.message?.trim()) {
    return c.json({ error: "Missing 'message' in request body" }, 400);
  }

  // Get or create the conversation for this session
  const ctx = await getOrCreateSession(sessionId, tenantId);
  if (!ctx) {
    return c.json({ error: `Unknown tenant: ${tenantId}` }, 404);
  }

  // Check daily token limit (aggregate across all sessions for this tenant)
  const config = (await getTenantConfig(tenantId))!;
  if (config.maxTokensPerDay > 0) {
    const dailyUsage = await getDailyTokenUsage(tenantId);
    if (dailyUsage >= config.maxTokensPerDay) {
      return c.json({ error: "Daily token limit exceeded" }, 429);
    }
  }

  // Add the user's message to the conversation
  ctx.messages.push({ role: "user", content: body.message.trim() });

  // Save immediately so the session appears in conversations list while LLM is thinking
  await saveSession(ctx);

  // Use client-provided API key if present, otherwise fall back to server's default provider
  const clientProvider = providerFromClientKey({
    geminiKey: c.req.header("X-Gemini-Key"),
    groqKey: c.req.header("X-Groq-Key"),
  });
  const activeProvider = clientProvider || provider;

  // Run the agent loop with this conversation's context
  const result = await agentTurn(ctx, activeProvider);

  // Persist final state: save conversation with assistant response + log token usage
  await saveSession(ctx);
  await logTokenUsage(tenantId, sessionId, result.turnTokens);

  return c.json({
    response: result.text,
    tokenUsage: {
      turn: result.turnTokens,
      session: ctx.tokenUsage,
    },
    sessionId,
    tenantId,
  });
});

// ── POST /chat/stream — SSE streaming response ────────────────────────────

app.post("/chat/stream", async (c) => {
  const tenantId = c.get("tenantId");
  const sessionId = c.get("sessionId");

  const body = await c.req.json<{ message?: string }>();
  if (!body.message?.trim()) {
    return c.json({ error: "Missing 'message' in request body" }, 400);
  }

  const ctx = await getOrCreateSession(sessionId, tenantId);
  if (!ctx) {
    return c.json({ error: `Unknown tenant: ${tenantId}` }, 404);
  }

  const config = (await getTenantConfig(tenantId))!;
  if (config.maxTokensPerDay > 0) {
    const dailyUsage = await getDailyTokenUsage(tenantId);
    if (dailyUsage >= config.maxTokensPerDay) {
      return c.json({ error: "Daily token limit exceeded" }, 429);
    }
  }

  ctx.messages.push({ role: "user", content: body.message.trim() });
  await saveSession(ctx);

  const clientProvider = providerFromClientKey({
    geminiKey: c.req.header("X-Gemini-Key"),
    groqKey: c.req.header("X-Groq-Key"),
  });
  const activeProvider = clientProvider || provider;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        for await (const event of agentTurnStream(ctx, activeProvider)) {
          switch (event.type) {
            case "text":
              send("text", { token: event.token });
              break;
            case "tool_start":
              send("tool_start", { name: event.name, args: event.args });
              break;
            case "tool_end":
              send("tool_end", { name: event.name, result: event.result, ok: event.ok });
              break;
            case "error":
              send("error", { message: event.message });
              break;
            case "done":
              await saveSession(ctx);
              await logTokenUsage(tenantId, sessionId, event.turnTokens);
              send("done", { text: event.text, turnTokens: event.turnTokens });
              break;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Stream error";
        send("error", { message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

// ── DELETE /chat/session — clear a conversation ─────────────────────────────

app.delete("/chat/session", async (c) => {
  const sessionId = c.get("sessionId");
  await deleteSession(sessionId);
  return c.json({ ok: true, message: "Session cleared" });
});

// ── GET /health — status check ──────────────────────────────────────────────

app.get("/health", async (c) => {
  const sessions = await sessionCount();
  return c.json({
    status: "ok",
    provider: provider.name,
    activeSessions: sessions,
  });
});

// ── Admin API ──────────────────────────────────────────────────────────────

const adminPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/helpdesk_ai",
  max: 5
});

// GET /admin/tenant/:tenantId — get tenant config
app.get("/admin/tenant/:tenantId", async (c) => {
  const tenantId = c.req.param("tenantId");
  const config = await getTenantConfig(tenantId);
  if (!config) return c.json({ error: "Tenant not found" }, 404);
  return c.json(config);
});

// PUT /admin/tenant — update tenant config
app.put("/admin/tenant", async (c) => {
  const body = await c.req.json<{ tenantId: string; systemPrompt?: string; maxTokensPerDay?: number }>();
  if (!body.tenantId) return c.json({ error: "Missing tenantId" }, 400);

  const existing = await getTenantConfig(body.tenantId);
  if (!existing) return c.json({ error: "Tenant not found" }, 404);

  await adminPool.query(
    `UPDATE tenants SET system_prompt = $1, max_tokens_per_day = $2, updated_at = NOW() WHERE tenant_id = $3`,
    [body.systemPrompt ?? existing.systemPrompt, body.maxTokensPerDay ?? existing.maxTokensPerDay, body.tenantId]
  );
  await invalidateTenantCache(body.tenantId);

  return c.json({ ok: true });
});

// GET /admin/usage — daily token breakdown
app.get("/admin/usage", async (c) => {
  const tenantId = c.req.query("tenant_id");
  if (!tenantId) return c.json({ error: "Missing tenant_id" }, 400);

  const result = await adminPool.query(
    `SELECT DATE(created_at) as date,
            SUM(prompt_tokens) as prompt_tokens,
            SUM(completion_tokens) as completion_tokens,
            SUM(total_tokens) as total_tokens,
            COUNT(*) as request_count
     FROM token_usage
     WHERE tenant_id = $1
     GROUP BY DATE(created_at)
     ORDER BY date DESC
     LIMIT 30`,
    [tenantId]
  );

  // Also get today's total
  const todayResult = await adminPool.query(
    `SELECT COALESCE(SUM(total_tokens), 0) as total
     FROM token_usage WHERE tenant_id = $1 AND created_at >= CURRENT_DATE`,
    [tenantId]
  );

  // Get hourly breakdown for today
  const hourlyResult = await adminPool.query(
    `SELECT EXTRACT(HOUR FROM created_at)::int as hour, SUM(total_tokens) as tokens
     FROM token_usage
     WHERE tenant_id = $1 AND created_at >= CURRENT_DATE
     GROUP BY hour ORDER BY hour`,
    [tenantId]
  );

  // Build 24-hour array
  const hourly = new Array(24).fill(0);
  for (const row of hourlyResult.rows) {
    hourly[row.hour] = parseInt(row.tokens, 10);
  }

  return c.json({
    daily: result.rows,
    todayTotal: parseInt(todayResult.rows[0].total, 10),
    hourly,
  });
});

// GET /admin/sessions — list active sessions from Redis + historical from Postgres
app.get("/admin/sessions", async (c) => {
  const tenantId = c.req.query("tenant_id");
  if (!tenantId) return c.json({ error: "Missing tenant_id" }, 400);

  const sessions: Array<{
    id: string; tenantId: string; turns: number;
    tokens: number; messageCount: number; source: string;
  }> = [];

  // 1. Try Redis for active sessions
  try {
    const r = getRedis();
    const keys = await r.keys("session:*");
    // Scan Redis for active sessions

    for (const key of keys) {
      const raw = await r.get(key);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (data.tenantId !== tenantId) continue;

      const userMsgCount = data.messages?.filter((m: { role: string }) => m.role === "user").length || 0;
      sessions.push({
        id: data.sessionId,
        tenantId: data.tenantId,
        turns: userMsgCount,
        tokens: data.tokenUsage?.totalTokens || 0,
        messageCount: data.messages?.length || 0,
        source: "redis",
      });
    }
  } catch (err) {
    console.error("[admin/sessions] Redis error:", err);
  }

  // 2. Also get session IDs from token_usage table (historical)
  try {
    const result = await adminPool.query(
      `SELECT session_id,
              COUNT(*) as turn_count,
              SUM(total_tokens) as total_tokens,
              MAX(created_at) as last_active
       FROM token_usage
       WHERE tenant_id = $1
       GROUP BY session_id
       ORDER BY last_active DESC
       LIMIT 50`,
      [tenantId],
    );

    const redisIds = new Set(sessions.map((s) => s.id));
    for (const row of result.rows) {
      if (redisIds.has(row.session_id)) continue; // already in Redis list
      sessions.push({
        id: row.session_id,
        tenantId,
        turns: parseInt(row.turn_count, 10),
        tokens: parseInt(row.total_tokens, 10),
        messageCount: parseInt(row.turn_count, 10) * 2, // estimate
        source: "postgres",
      });
    }
  } catch (err) {
    console.error("[admin/sessions] Postgres error:", err);
  }

  return c.json({ sessions });
});

// GET /admin/conversations/:sessionId — get conversation transcript
app.get("/admin/conversations/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");

  try {
    const r = getRedis();
    const raw = await r.get("session:" + sessionId);
    if (!raw) return c.json({ error: "Session not found" }, 404);

    const data = JSON.parse(raw);
    return c.json({
      sessionId: data.sessionId,
      tenantId: data.tenantId,
      messages: data.messages || [],
      tokenUsage: data.tokenUsage,
    });
  } catch {
    return c.json({ error: "Failed to load session" }, 500);
  }
});

// GET /admin/knowledge — list indexed documents/chunks
app.get("/admin/knowledge", async (c) => {
  const tenantId = c.req.query("tenant_id");
  if (!tenantId) return c.json({ error: "Missing tenant_id" }, 400);

  const result = await adminPool.query(
    `SELECT doc_title, source_file, doc_type,
            COUNT(*) as chunk_count,
            SUM(LENGTH(content)) as total_chars,
            MAX(id) as latest_chunk_id
     FROM chunks
     WHERE tenant_id = $1
     GROUP BY doc_title, source_file, doc_type
     ORDER BY doc_title`,
    [tenantId]
  );

  const totalResult = await adminPool.query(
    `SELECT COUNT(*) as total_chunks FROM chunks WHERE tenant_id = $1`,
    [tenantId]
  );

  return c.json({
    documents: result.rows,
    totalChunks: parseInt(totalResult.rows[0].total_chunks, 10),
  });
});

// ── Simple chunker for uploaded files (no external dependency) ──────────────
// Splits markdown by headings into chunks of ~1500 chars max.
// For production, use the full ingestion pipeline in packages/ingestion.
function chunkMarkdown(text: string, fileName: string, tenantId: string) {
  const lines = text.split("\n");
  const chunks: Array<{
    id: string; tenant_id: string; source_file: string;
    doc_title: string; section_path: string; content: string; doc_type: string;
  }> = [];

  // Extract title from first heading or filename
  const titleMatch = text.match(/^#\s+(.+)/m);
  const docTitle = titleMatch ? titleMatch[1].trim() : fileName.replace(/\.(md|mdx|txt)$/, "");

  let currentSection = docTitle;
  let buffer = "";
  let chunkIdx = 0;

  const flush = () => {
    const content = buffer.trim();
    if (!content) return;
    const id = `upload-${tenantId}-${fileName}-${chunkIdx}`.replace(/[^a-zA-Z0-9-_]/g, "_");
    chunks.push({
      id,
      tenant_id: tenantId,
      source_file: fileName,
      doc_title: docTitle,
      section_path: currentSection,
      content,
      doc_type: "upload",
    });
    chunkIdx++;
    buffer = "";
  };

  for (const line of lines) {
    // Split on headings
    if (/^#{1,3}\s/.test(line)) {
      flush();
      currentSection = line.replace(/^#+\s*/, "").trim();
    }
    buffer += line + "\n";
    // Also split if buffer gets too large (~1500 chars)
    if (buffer.length > 1500) flush();
  }
  flush();

  return chunks;
}

// POST /admin/knowledge/upload — upload markdown files for indexing
// Inserts chunks into Postgres without embedding (use Re-index to embed later).
// This avoids requiring Ollama to be running for file uploads.
app.post("/admin/knowledge/upload", async (c) => {
  const formData = await c.req.formData();
  const tenantId = formData.get("tenant_id") as string;
  if (!tenantId) return c.json({ error: "Missing tenant_id" }, 400);

  const files = formData.getAll("files") as File[];
  if (!files.length) return c.json({ error: "No files provided" }, 400);

  let totalChunks = 0;
  const results: Array<{ file: string; chunks: number; error?: string }> = [];

  for (const file of files) {
    const text = await file.text();
    const fileName = file.name;

    try {
      const chunks = chunkMarkdown(text, fileName, tenantId);

      for (const chunk of chunks) {
        await adminPool.query(
          `INSERT INTO chunks (id, tenant_id, source_file, doc_title, section_path, content, doc_type, search_vector)
           VALUES ($1, $2, $3, $4, $5, $6, $7, to_tsvector('english', $6))
           ON CONFLICT (id) DO UPDATE SET content = $6, doc_title = $4, search_vector = to_tsvector('english', $6)`,
          [chunk.id, chunk.tenant_id, chunk.source_file, chunk.doc_title, chunk.section_path, chunk.content, chunk.doc_type]
        );
      }

      totalChunks += chunks.length;
      results.push({ file: fileName, chunks: chunks.length });
      console.log(`[upload] ${fileName} -> ${chunks.length} chunks for tenant=${tenantId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[upload] Failed ${fileName}:`, msg);
      results.push({ file: fileName, chunks: 0, error: msg });
    }
  }

  return c.json({ ok: true, totalChunks, results });
});

// DELETE /admin/knowledge — delete all chunks for a tenant
app.delete("/admin/knowledge", async (c) => {
  const tenantId = c.req.query("tenant_id");
  if (!tenantId) return c.json({ error: "Missing tenant_id" }, 400);

  try {
    const result = await adminPool.query(
      `DELETE FROM chunks WHERE tenant_id = $1`,
      [tenantId],
    );
    const deleted = result.rowCount ?? 0;
    console.log(`[knowledge] Deleted ${deleted} chunks for tenant=${tenantId}`);
    return c.json({ ok: true, deleted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Delete failed: ${msg}` }, 500);
  }
});

// POST /admin/knowledge/reindex — re-embed all chunks for a tenant
app.post("/admin/knowledge/reindex", async (c) => {
  const body = await c.req.json<{ tenant_id?: string }>();
  const tenantId = body.tenant_id;
  if (!tenantId) return c.json({ error: "Missing tenant_id" }, 400);

  try {
    const { embedText } = await import("@helpdesk-ai/shared");

    // Get all chunks without embeddings or all chunks for re-embedding
    const result = await adminPool.query(
      `SELECT id, content FROM chunks WHERE tenant_id = $1`,
      [tenantId]
    );

    let updated = 0;
    const BATCH_SIZE = 5;

    for (let i = 0; i < result.rows.length; i += BATCH_SIZE) {
      const batch = result.rows.slice(i, i + BATCH_SIZE);
      const texts = batch.map((r: { content: string }) => r.content);
      const embeddings = await embedText(texts);

      for (let j = 0; j < batch.length; j++) {
        await adminPool.query(
          `UPDATE chunks SET embedding = $1::vector, search_vector = to_tsvector('english', content) WHERE id = $2`,
          [JSON.stringify(embeddings[j]), batch[j].id]
        );
        updated++;
      }
    }

    return c.json({ ok: true, updated, total: result.rows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Reindex failed: ${msg}` }, 500);
  }
});

// ── Startup ─────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT || "3001", 10);

// Ensure DB tables exist before accepting requests
await ensureSchema();

console.log(`\nHelpdesk AI server starting...`);
console.log(`  Provider: ${provider.name}`);
console.log(`  Port: ${port}`);
console.log(`  Endpoints:`);
console.log(`    POST /chat          — send a message`);
console.log(`    DELETE /chat/session — clear conversation`);
console.log(`    GET /health         — status check`);
console.log(`    GET /admin/tenant/:id  — get tenant config`);
console.log(`    PUT /admin/tenant      — update tenant config`);
console.log(`    GET /admin/usage       — token usage breakdown`);
console.log(`    GET /admin/sessions    — list active sessions`);
console.log(`    GET /admin/conversations/:id — conversation transcript`);
console.log(`    GET /admin/knowledge   — indexed documents`);
console.log(`    POST /admin/knowledge/upload  — upload files for indexing`);
console.log(`    POST /admin/knowledge/reindex — re-embed all chunks\n`);

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("\n[server] Shutting down...");
  await closeConnections();
  process.exit(0);
});

export default {
  port,
  fetch: app.fetch,
};
