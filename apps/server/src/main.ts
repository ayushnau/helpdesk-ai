import dotenv from "dotenv";
dotenv.config();

console.log("[env] DATABASE_URL:", process.env.DATABASE_URL ? "set" : "NOT SET");
console.log("[env] REDIS_URL:", process.env.REDIS_URL ? "set" : "NOT SET");
console.log("[env] LLM_PROVIDER:", process.env.LLM_PROVIDER || "NOT SET");
console.log("[env] GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "set" : "NOT SET");

import { Hono } from "hono";
import { cors } from "hono/cors";
import { ensureSchema, closeConnections, provider } from "@helpdesk-ai/agent-core";

import { registerChatRoutes } from "./routes/chat.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerWidgetRoutes } from "./routes/widget.js";

// ── App setup ──────────────────────────────────────────────────────────────

type Variables = { tenantId: string; sessionId: string };
const app = new Hono<{ Variables: Variables }>();

// CORS: widget endpoints allow all origins (embedded on merchant sites)
// Dashboard/admin/chat endpoints restricted to our frontend
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:3000").split(",");
app.use("/widget/*", cors({ origin: "*" }));
app.use("/widget.js", cors({ origin: "*" }));
app.use("/*", cors({ origin: ALLOWED_ORIGINS }));

// ── Routes ─────────────────────────────────────────────────────────────────

registerChatRoutes(app);
registerAuthRoutes(app);
registerAdminRoutes(app);
registerWidgetRoutes(app);

// ── Startup ────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT || "3001", 10);

await ensureSchema();

console.log(`\nHelpdesk AI server starting...`);
console.log(`  Provider: ${provider.name}`);
console.log(`  Port: ${port}`);
console.log(`  Endpoints:`);
console.log(`    POST /auth/signup              — register a new user`);
console.log(`    POST /auth/login               — authenticate user`);
console.log(`    POST /chat                     — send a message`);
console.log(`    POST /chat/stream              — SSE streaming chat`);
console.log(`    DELETE /chat/session            — clear conversation`);
console.log(`    GET /health                    — status check`);
console.log(`    GET /admin/tenant/:id          — get tenant config`);
console.log(`    PUT /admin/tenant              — update tenant config`);
console.log(`    GET /admin/usage               — token usage breakdown`);
console.log(`    GET /admin/sessions            — list active sessions`);
console.log(`    GET /admin/conversations/:id   — conversation transcript`);
console.log(`    GET /admin/knowledge           — indexed documents`);
console.log(`    POST /admin/knowledge/upload   — upload files for indexing`);
console.log(`    POST /admin/knowledge/reindex  — re-embed all chunks`);
console.log(`    PUT /admin/tenant/api-key      — save encrypted LLM API key`);
console.log(`    GET /admin/tenant/widget-token — get/generate widget token`);
console.log(`    POST /widget/chat              — widget chat (SSE stream)`);
console.log(`    GET /widget.js                 — embeddable widget script\n`);

process.on("SIGTERM", async () => {
  console.log("\n[server] Shutting down...");
  await closeConnections();
  process.exit(0);
});

export default { port, fetch: app.fetch };
