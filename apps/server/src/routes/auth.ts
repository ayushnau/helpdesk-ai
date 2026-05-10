import type { Hono } from "hono";
import { getTenantConfig } from "@helpdesk-ai/agent-core";
import { pool } from "../db.js";

export function registerAuthRoutes(app: Hono) {
  // POST /auth/signup — register a new user + auto-create tenant
  app.post("/auth/signup", async (c) => {
    const body = await c.req.json<{ email?: string; password?: string; name?: string; companyName?: string }>();
    if (!body.email || !body.password || !body.name || !body.companyName) {
      return c.json({ error: "Missing required fields: email, password, name, companyName" }, 400);
    }

    const tenantId = body.companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!tenantId) return c.json({ error: "Invalid company name" }, 400);

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [body.email]);
    if (existing.rows.length > 0) {
      return c.json({ error: "Email already registered" }, 409);
    }

    const defaultPrompt = `You are a helpful support assistant for ${body.companyName}. Be concise and professional. You MUST use the provided tools to answer questions. When answering from search_knowledge results, cite the source.`;
    await pool.query(
      `INSERT INTO tenants (tenant_id, system_prompt, max_tokens_per_day) VALUES ($1, $2, 100000) ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId, defaultPrompt],
    );

    const hash = await Bun.password.hash(body.password);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, tenant_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [body.email, hash, body.name, tenantId],
    );

    return c.json({
      ok: true,
      user: { id: result.rows[0].id, email: body.email, name: body.name, tenantId, tenantName: body.companyName.trim() },
    });
  });

  // POST /auth/login — authenticate an existing user
  app.post("/auth/login", async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();
    if (!body.email || !body.password) {
      return c.json({ error: "Missing required fields: email, password" }, 400);
    }

    const result = await pool.query(
      "SELECT id, email, name, password_hash, tenant_id FROM users WHERE email = $1",
      [body.email],
    );
    if (result.rows.length === 0) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    const user = result.rows[0];
    const valid = await Bun.password.verify(body.password, user.password_hash);
    if (!valid) return c.json({ error: "Invalid email or password" }, 401);

    const tenantName = user.tenant_id === "posthog" ? "PostHog" : user.tenant_id === "acme" ? "Acme Corp" : user.tenant_id;

    return c.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, tenantId: user.tenant_id, tenantName },
    });
  });
}
