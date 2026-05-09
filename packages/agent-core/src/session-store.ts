import type { ConversationContext } from "./tenant.js";
import { createConversationContext, getTenantConfig, getRedis } from "./tenant.js";

// ── Redis-backed session store ──────────────────────────────────────────────
//
// Each session (conversation) is stored in Redis as a JSON blob.
// Key format: "session:{sessionId}"
// TTL: 24 hours of inactivity (refreshed on each access).
//
// Why Redis over in-memory Map:
//   - Survives server restarts
//   - Works across multiple server instances (horizontal scaling)
//   - Built-in TTL expiry (no manual sweep needed)
//   - Bounded memory (Redis maxmemory + eviction policy)
//
// Fallback: in-memory Map when Redis is unavailable (REPL mode).

const SESSION_TTL = 24 * 60 * 60; // 24 hours in seconds
const SESSION_PREFIX = "session:";

// In-memory fallback for REPL / when Redis is down
const localSessions = new Map<string, ConversationContext>();

/** Serialize a ConversationContext to JSON for Redis storage */
function serialize(ctx: ConversationContext): string {
  return JSON.stringify({
    sessionId: ctx.sessionId,
    tenantId: ctx.tenantConfig.tenantId,
    messages: ctx.messages,
    memoryState: ctx.memoryState,
    tokenUsage: ctx.tokenUsage,
  });
}

/** Deserialize a ConversationContext from Redis JSON */
async function deserialize(json: string): Promise<ConversationContext | null> {
  const data = JSON.parse(json);
  const tenantConfig = await getTenantConfig(data.tenantId);
  if (!tenantConfig) return null;

  return {
    sessionId: data.sessionId,
    tenantConfig,
    messages: data.messages,
    memoryState: data.memoryState,
    tokenUsage: data.tokenUsage,
  };
}

/**
 * Get or create a conversation context for a given session + tenant.
 * Tries Redis first, falls back to in-memory.
 */
export async function getOrCreateSession(
  sessionId: string,
  tenantId: string,
): Promise<ConversationContext | null> {
  // Try Redis first
  try {
    const r = getRedis();
    const cached = await r.get(SESSION_PREFIX + sessionId);
    if (cached) {
      const ctx = await deserialize(cached);
      if (ctx) {
        // Refresh TTL on access
        await r.expire(SESSION_PREFIX + sessionId, SESSION_TTL);
        return ctx;
      }
    }
  } catch {
    // Redis unavailable — try local fallback
  }

  // Check local fallback
  const local = localSessions.get(sessionId);
  if (local) return local;

  // Create new session
  const tenantConfig = await getTenantConfig(tenantId);
  if (!tenantConfig) return null;

  const ctx = createConversationContext(sessionId, tenantConfig);
  localSessions.set(sessionId, ctx);
  return ctx;
}

/**
 * Save a conversation context back to Redis after an agent turn.
 * Must be called after agentTurn completes so the new messages are persisted.
 */
export async function saveSession(ctx: ConversationContext): Promise<void> {
  try {
    const r = getRedis();
    await r.set(SESSION_PREFIX + ctx.sessionId, serialize(ctx), "EX", SESSION_TTL);
  } catch {
    // Redis unavailable — session lives in local Map only
    localSessions.set(ctx.sessionId, ctx);
  }
}

/** Delete a session */
export async function deleteSession(sessionId: string): Promise<boolean> {
  localSessions.delete(sessionId);
  try {
    const r = getRedis();
    const deleted = await r.del(SESSION_PREFIX + sessionId);
    return deleted > 0;
  } catch {
    return false;
  }
}

/** Count active sessions (approximate — Redis count + local count) */
export async function sessionCount(): Promise<number> {
  try {
    const r = getRedis();
    const keys = await r.keys(SESSION_PREFIX + "*");
    return keys.length;
  } catch {
    return localSessions.size;
  }
}
