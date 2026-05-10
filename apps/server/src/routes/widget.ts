/**
 * Widget routes — endpoints for the embeddable chat widget.
 *
 * POST /widget/chat  — end-user SSE streaming chat (auth via widget token)
 * GET  /widget.js    — serves the self-contained widget script
 *
 * These endpoints use permissive CORS (origin: "*") because the widget
 * is embedded on third-party merchant websites.
 */

import type { Hono } from "hono";
import {
  agentTurnStream,
  getOrCreateSession,
  saveSession,
  getTenantByWidgetToken,
  getEncryptedApiKey,
  getDailyTokenUsage,
  logTokenUsage,
  provider,
  providerFromClientKey,
} from "@helpdesk-ai/agent-core";
import crypto from "crypto";
import { decrypt } from "../crypto.js";
import { getWidgetScript } from "../widget-script.js";

export function registerWidgetRoutes(app: Hono) {
  // Explicit OPTIONS handler for CORS preflight (needed for cross-origin POST)
  app.options("/widget/chat", (c) => {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Widget-Key",
        "Access-Control-Max-Age": "86400",
      },
    });
  });

  // POST /widget/chat — end-user chat via embed widget
  app.post("/widget/chat", async (c) => {
    const widgetKey = c.req.header("X-Widget-Key");
    if (!widgetKey) return c.json({ error: "Missing X-Widget-Key header" }, 401);

    const body = await c.req.json<{ message?: string; sessionId?: string }>();
    if (!body.message?.trim()) return c.json({ error: "Missing message" }, 400);

    const tenant = await getTenantByWidgetToken(widgetKey);
    if (!tenant) return c.json({ error: "Invalid widget key" }, 401);

    const sessionId = body.sessionId || crypto.randomUUID();
    const ctx = await getOrCreateSession(sessionId, tenant.tenantId);
    if (!ctx) return c.json({ error: "Failed to create session" }, 500);

    if (tenant.maxTokensPerDay > 0) {
      const dailyUsage = await getDailyTokenUsage(tenant.tenantId);
      if (dailyUsage >= tenant.maxTokensPerDay) {
        return c.json({ error: "Daily token limit exceeded" }, 429);
      }
    }

    ctx.messages.push({ role: "user", content: body.message.trim() });
    await saveSession(ctx);

    // Use tenant's encrypted API key if available, otherwise server default
    let activeProvider = provider;
    const encryptedKey = await getEncryptedApiKey(tenant.tenantId);
    if (encryptedKey) {
      try {
        const apiKey = decrypt(encryptedKey);
        const clientProv = providerFromClientKey({ geminiKey: apiKey });
        if (clientProv) activeProvider = clientProv;
      } catch {
        // Decryption failed — fall back to default
      }
    }

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
              case "tool_start": send("tool_start", { name: event.name }); break;
              case "tool_end": send("tool_end", { name: event.name, ok: event.ok }); break;
              case "error": send("error", { message: event.message }); break;
              case "done":
                await saveSession(ctx);
                await logTokenUsage(tenant.tenantId, sessionId, event.turnTokens);
                send("done", { sessionId, turnTokens: event.turnTokens });
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

  // GET /widget.js — serve the embeddable widget script
  app.get("/widget.js", async (c) => {
    // Render proxies HTTPS → HTTP internally, so c.req.url is http://
    // Force https:// in production
    let baseUrl = c.req.url.replace("/widget.js", "");
    if (baseUrl.startsWith("http://") && !baseUrl.includes("localhost")) {
      baseUrl = baseUrl.replace("http://", "https://");
    }
    const script = getWidgetScript(baseUrl);
    return new Response(script, {
      headers: {
        "Content-Type": "application/javascript",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  });
}
