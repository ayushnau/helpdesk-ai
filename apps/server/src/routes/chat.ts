import type { Hono } from "hono";
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
  provider,
  providerFromClientKey,
} from "@helpdesk-ai/agent-core";

export function registerChatRoutes(app: Hono<{ Variables: { tenantId: string; sessionId: string } }>) {
  // Middleware: extract tenant + session from headers
  app.use("/chat/*", async (c, next) => {
    const tenantId = c.req.header("X-Tenant-ID");
    const sessionId = c.req.header("X-Session-ID");

    if (!tenantId || !sessionId) {
      return c.json({ error: "Missing X-Tenant-ID or X-Session-ID header" }, 400);
    }

    const config = await getTenantConfig(tenantId);
    if (!config) {
      return c.json({ error: `Unknown tenant: ${tenantId}` }, 404);
    }

    c.set("tenantId", tenantId);
    c.set("sessionId", sessionId);
    await next();
  });

  // POST /chat — send a message, get a response
  app.post("/chat", async (c) => {
    const tenantId = c.get("tenantId");
    const sessionId = c.get("sessionId");

    const body = await c.req.json<{ message?: string }>();
    if (!body.message?.trim()) {
      return c.json({ error: "Missing 'message' in request body" }, 400);
    }

    const ctx = await getOrCreateSession(sessionId, tenantId);
    if (!ctx) return c.json({ error: `Unknown tenant: ${tenantId}` }, 404);

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

    const result = await agentTurn(ctx, activeProvider);
    await saveSession(ctx);
    await logTokenUsage(tenantId, sessionId, result.turnTokens);

    return c.json({
      response: result.text,
      tokenUsage: { turn: result.turnTokens, session: ctx.tokenUsage },
      sessionId,
      tenantId,
    });
  });

  // POST /chat/stream — SSE streaming response
  app.post("/chat/stream", async (c) => {
    const tenantId = c.get("tenantId");
    const sessionId = c.get("sessionId");

    const body = await c.req.json<{ message?: string }>();
    if (!body.message?.trim()) {
      return c.json({ error: "Missing 'message' in request body" }, 400);
    }

    const ctx = await getOrCreateSession(sessionId, tenantId);
    if (!ctx) return c.json({ error: `Unknown tenant: ${tenantId}` }, 404);

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
              case "text": send("text", { token: event.token }); break;
              case "tool_start": send("tool_start", { name: event.name, args: event.args }); break;
              case "tool_end": send("tool_end", { name: event.name, result: event.result, ok: event.ok }); break;
              case "error": send("error", { message: event.message }); break;
              case "done":
                await saveSession(ctx);
                await logTokenUsage(tenantId, sessionId, event.turnTokens);
                send("done", { text: event.text, turnTokens: event.turnTokens });
                break;
            }
          }
        } catch (err) {
          send("error", { message: err instanceof Error ? err.message : "Stream error" });
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

  // DELETE /chat/session — clear a conversation
  app.delete("/chat/session", async (c) => {
    const sessionId = c.get("sessionId");
    await deleteSession(sessionId);
    return c.json({ ok: true, message: "Session cleared" });
  });

  // GET /health — status check
  app.get("/health", async (c) => {
    const sessions = await sessionCount();
    return c.json({
      status: "ok",
      provider: provider.name,
      activeSessions: sessions,
    });
  });
}
