import type { Hono } from "hono";
import {
  getTenantConfig,
  invalidateTenantCache,
  getDailyTokenUsage,
  getRedis,
  saveEncryptedApiKey,
  generateWidgetToken,
} from "@helpdesk-ai/agent-core";
import { pool } from "../db.js";
import { encrypt } from "../crypto.js";

export function registerAdminRoutes(app: Hono) {
  // GET /admin/tenant/:tenantId
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

    await pool.query(
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

    const [result, todayResult, hourlyResult] = await Promise.all([
      pool.query(
        `SELECT DATE(created_at) as date, SUM(prompt_tokens) as prompt_tokens, SUM(completion_tokens) as completion_tokens, SUM(total_tokens) as total_tokens, COUNT(*) as request_count
         FROM token_usage WHERE tenant_id = $1 GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30`,
        [tenantId]
      ),
      pool.query(
        `SELECT COALESCE(SUM(total_tokens), 0) as total FROM token_usage WHERE tenant_id = $1 AND created_at >= CURRENT_DATE`,
        [tenantId]
      ),
      pool.query(
        `SELECT EXTRACT(HOUR FROM created_at)::int as hour, SUM(total_tokens) as tokens FROM token_usage WHERE tenant_id = $1 AND created_at >= CURRENT_DATE GROUP BY hour ORDER BY hour`,
        [tenantId]
      ),
    ]);

    const hourly = new Array(24).fill(0);
    for (const row of hourlyResult.rows) hourly[row.hour] = parseInt(row.tokens, 10);

    return c.json({
      daily: result.rows,
      todayTotal: parseInt(todayResult.rows[0].total, 10),
      hourly,
    });
  });

  // GET /admin/sessions — active + historical sessions
  app.get("/admin/sessions", async (c) => {
    const tenantId = c.req.query("tenant_id");
    if (!tenantId) return c.json({ error: "Missing tenant_id" }, 400);

    const sessions: Array<{ id: string; tenantId: string; turns: number; tokens: number; messageCount: number; source: string }> = [];

    try {
      const r = getRedis();
      const keys = await r.keys("session:*");
      for (const key of keys) {
        const raw = await r.get(key);
        if (!raw) continue;
        const data = JSON.parse(raw);
        if (data.tenantId !== tenantId) continue;
        const userMsgCount = data.messages?.filter((m: { role: string }) => m.role === "user").length || 0;
        sessions.push({ id: data.sessionId, tenantId: data.tenantId, turns: userMsgCount, tokens: data.tokenUsage?.totalTokens || 0, messageCount: data.messages?.length || 0, source: "redis" });
      }
    } catch (err) {
      console.error("[admin/sessions] Redis error:", err);
    }

    try {
      const result = await pool.query(
        `SELECT session_id, COUNT(*) as turn_count, SUM(total_tokens) as total_tokens, MAX(created_at) as last_active FROM token_usage WHERE tenant_id = $1 GROUP BY session_id ORDER BY last_active DESC LIMIT 50`,
        [tenantId],
      );
      const redisIds = new Set(sessions.map((s) => s.id));
      for (const row of result.rows) {
        if (redisIds.has(row.session_id)) continue;
        sessions.push({ id: row.session_id, tenantId, turns: parseInt(row.turn_count, 10), tokens: parseInt(row.total_tokens, 10), messageCount: parseInt(row.turn_count, 10) * 2, source: "postgres" });
      }
    } catch (err) {
      console.error("[admin/sessions] Postgres error:", err);
    }

    return c.json({ sessions });
  });

  // GET /admin/conversations/:sessionId
  app.get("/admin/conversations/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId");
    try {
      const r = getRedis();
      const raw = await r.get("session:" + sessionId);
      if (!raw) return c.json({ error: "Session not found" }, 404);
      const data = JSON.parse(raw);
      return c.json({ sessionId: data.sessionId, tenantId: data.tenantId, messages: data.messages || [], tokenUsage: data.tokenUsage });
    } catch {
      return c.json({ error: "Failed to load session" }, 500);
    }
  });

  // GET /admin/knowledge
  app.get("/admin/knowledge", async (c) => {
    const tenantId = c.req.query("tenant_id");
    if (!tenantId) return c.json({ error: "Missing tenant_id" }, 400);

    const [result, totalResult] = await Promise.all([
      pool.query(
        `SELECT doc_title, source_file, doc_type, COUNT(*) as chunk_count, SUM(LENGTH(content)) as total_chars FROM chunks WHERE tenant_id = $1 GROUP BY doc_title, source_file, doc_type ORDER BY doc_title`,
        [tenantId]
      ),
      pool.query(`SELECT COUNT(*) as total_chunks FROM chunks WHERE tenant_id = $1`, [tenantId]),
    ]);

    return c.json({ documents: result.rows, totalChunks: parseInt(totalResult.rows[0].total_chunks, 10) });
  });

  // DELETE /admin/knowledge
  app.delete("/admin/knowledge", async (c) => {
    const tenantId = c.req.query("tenant_id");
    if (!tenantId) return c.json({ error: "Missing tenant_id" }, 400);
    try {
      const result = await pool.query(`DELETE FROM chunks WHERE tenant_id = $1`, [tenantId]);
      console.log(`[knowledge] Deleted ${result.rowCount ?? 0} chunks for tenant=${tenantId}`);
      return c.json({ ok: true, deleted: result.rowCount ?? 0 });
    } catch (err) {
      return c.json({ error: `Delete failed: ${err instanceof Error ? err.message : err}` }, 500);
    }
  });

  // POST /admin/knowledge/upload
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
          await pool.query(
            `INSERT INTO chunks (id, tenant_id, source_file, doc_title, section_path, content, doc_type, search_vector) VALUES ($1, $2, $3, $4, $5, $6, $7, to_tsvector('english', $6)) ON CONFLICT (id) DO UPDATE SET content = $6, doc_title = $4, search_vector = to_tsvector('english', $6)`,
            [chunk.id, chunk.tenant_id, chunk.source_file, chunk.doc_title, chunk.section_path, chunk.content, chunk.doc_type]
          );
        }
        // Auto-embed
        try {
          const { embedText } = await import("@helpdesk-ai/shared");
          const embeddings = await embedText(chunks.map((ch) => ch.content));
          for (let i = 0; i < chunks.length; i++) {
            await pool.query(`UPDATE chunks SET embedding = $1::vector WHERE id = $2`, [JSON.stringify(embeddings[i]), chunks[i].id]);
          }
        } catch (e) {
          console.warn(`[upload] Embedding failed: ${e instanceof Error ? e.message : e}`);
        }
        totalChunks += chunks.length;
        results.push({ file: fileName, chunks: chunks.length });
        console.log(`[upload] ${fileName} -> ${chunks.length} chunks for tenant=${tenantId}`);
      } catch (err) {
        results.push({ file: fileName, chunks: 0, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return c.json({ ok: true, totalChunks, results });
  });

  // POST /admin/knowledge/reindex
  app.post("/admin/knowledge/reindex", async (c) => {
    const body = await c.req.json<{ tenant_id?: string }>();
    if (!body.tenant_id) return c.json({ error: "Missing tenant_id" }, 400);
    try {
      const { embedText } = await import("@helpdesk-ai/shared");
      const result = await pool.query(`SELECT id, content FROM chunks WHERE tenant_id = $1`, [body.tenant_id]);
      let updated = 0;
      for (let i = 0; i < result.rows.length; i += 5) {
        const batch = result.rows.slice(i, i + 5);
        const embeddings = await embedText(batch.map((r: { content: string }) => r.content));
        for (let j = 0; j < batch.length; j++) {
          await pool.query(`UPDATE chunks SET embedding = $1::vector, search_vector = to_tsvector('english', content) WHERE id = $2`, [JSON.stringify(embeddings[j]), batch[j].id]);
          updated++;
        }
      }
      return c.json({ ok: true, updated, total: result.rows.length });
    } catch (err) {
      return c.json({ error: `Reindex failed: ${err instanceof Error ? err.message : err}` }, 500);
    }
  });

  // PUT /admin/tenant/api-key
  app.put("/admin/tenant/api-key", async (c) => {
    const body = await c.req.json<{ tenantId?: string; apiKey?: string }>();
    if (!body.tenantId || !body.apiKey) return c.json({ error: "Missing tenantId or apiKey" }, 400);
    await saveEncryptedApiKey(body.tenantId, encrypt(body.apiKey));
    return c.json({ ok: true });
  });

  // GET /admin/tenant/widget-token
  app.get("/admin/tenant/widget-token", async (c) => {
    const tenantId = c.req.query("tenant_id");
    if (!tenantId) return c.json({ error: "Missing tenant_id" }, 400);
    const config = await getTenantConfig(tenantId);
    if (!config) return c.json({ error: "Tenant not found" }, 404);
    const result = await pool.query("SELECT widget_token FROM tenants WHERE tenant_id = $1", [tenantId]);
    let token = result.rows[0]?.widget_token;
    if (!token) token = await generateWidgetToken(tenantId);
    return c.json({ token });
  });
}

// Simple markdown chunker for uploaded files
function chunkMarkdown(text: string, fileName: string, tenantId: string) {
  const lines = text.split("\n");
  const chunks: Array<{ id: string; tenant_id: string; source_file: string; doc_title: string; section_path: string; content: string; doc_type: string }> = [];
  const titleMatch = text.match(/^#\s+(.+)/m);
  const docTitle = titleMatch ? titleMatch[1].trim() : fileName.replace(/\.(md|mdx|txt)$/, "");
  let currentSection = docTitle;
  let buffer = "";
  let chunkIdx = 0;

  const flush = () => {
    const content = buffer.trim();
    if (!content) return;
    chunks.push({ id: `upload-${tenantId}-${fileName}-${chunkIdx}`.replace(/[^a-zA-Z0-9-_]/g, "_"), tenant_id: tenantId, source_file: fileName, doc_title: docTitle, section_path: currentSection, content, doc_type: "upload" });
    chunkIdx++;
    buffer = "";
  };

  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) { flush(); currentSection = line.replace(/^#+\s*/, "").trim(); }
    buffer += line + "\n";
    if (buffer.length > 1500) flush();
  }
  flush();
  return chunks;
}
