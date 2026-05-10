import pg from "pg";
import Redis from "ioredis";
import crypto from "crypto";
import type { Message, TokenUsage } from "./providers/index.js";
import type { MemoryState } from "./memory.js";

// ── Tenant Configuration ────────────────────────────────────────────────────

export interface TenantConfig {
  tenantId: string;
  systemPrompt: string;
  maxTokensPerDay: number;
}

// ── Conversation Context ────────────────────────────────────────────────────
// Created per-request. Everything that was a module-level singleton now
// lives here, scoped to one conversation.

export interface ConversationContext {
  sessionId: string;
  tenantConfig: TenantConfig;
  messages: Message[];
  memoryState: MemoryState;
  tokenUsage: TokenUsage;
}

/** Create a fresh conversation context for a tenant */
export function createConversationContext(
  sessionId: string,
  tenantConfig: TenantConfig,
): ConversationContext {
  return {
    sessionId,
    tenantConfig,
    messages: [
      { role: "system", content: tenantConfig.systemPrompt },
    ],
    memoryState: { summary: null },
    tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

// ── Connections ─────────────────────────────────────────────────────────────

// Strip sslmode from URL to avoid pg driver warnings — we handle SSL in code
const RAW_DB_URL = process.env.DATABASE_URL || "postgresql://localhost:5432/helpdesk_ai";
const DB_URL = RAW_DB_URL.replace(/[?&]sslmode=[^&]*/g, "").replace(/\?$/, "");
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// Pool instead of Client — reuses connections across requests.
const isCloudDB = !DB_URL.includes("localhost");
const pool = new pg.Pool({
  connectionString: DB_URL,
  max: 10,
  ...(isCloudDB ? { ssl: { rejectUnauthorized: false } } : {}),
});

let redis: Redis | null = null;

/** Get Redis client (lazy init so REPL doesn't require Redis running) */
export function getRedis(): Redis {
  if (!redis) {
    const isTLS = REDIS_URL.startsWith("rediss://");
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      ...(isTLS ? { tls: {} } : {}),
    });
  }
  return redis;
}

/** Graceful shutdown — close connections */
export async function closeConnections(): Promise<void> {
  await pool.end();
  if (redis) await redis.quit();
}

// ── Tenant Config: Postgres + Redis cache ───────────────────────────────────
//
// Source of truth: Postgres `tenants` table.
// Cache layer: Redis with 1-hour TTL.
// Fallback: in-memory Map for REPL / when Redis is unavailable.

const TENANT_CACHE_TTL = 60 * 60; // 1 hour in seconds
const TENANT_CACHE_PREFIX = "tenant:config:";

// In-memory fallback for REPL mode (no Redis required)
const localCache = new Map<string, TenantConfig>();

/**
 * Load tenant config. Checks: Redis cache → Postgres → null.
 * Caches in Redis on successful DB load.
 */
export async function getTenantConfig(tenantId: string): Promise<TenantConfig | null> {
  // 1. Check in-memory fallback (for seeded configs + REPL)
  const local = localCache.get(tenantId);
  if (local) return local;

  // 2. Check Redis cache
  try {
    const r = getRedis();
    const cached = await r.get(TENANT_CACHE_PREFIX + tenantId);
    if (cached) {
      const config = JSON.parse(cached) as TenantConfig;
      localCache.set(tenantId, config); // warm local cache too
      return config;
    }
  } catch {
    // Redis unavailable — fall through to Postgres
    //  developeer should be notified here. 
  }

  // 3. Load from Postgres
  try {
    const result = await pool.query(
      `SELECT tenant_id, system_prompt, max_tokens_per_day
       FROM tenants WHERE tenant_id = $1`,
      [tenantId],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const config: TenantConfig = {
      tenantId: row.tenant_id,
      systemPrompt: row.system_prompt,
      maxTokensPerDay: row.max_tokens_per_day ?? 0,
    };

    // Cache in Redis + local
    try {
      const r = getRedis();
      await r.set(
        TENANT_CACHE_PREFIX + tenantId,
        JSON.stringify(config),
        "EX",
        TENANT_CACHE_TTL,
      );
    } catch {
      // Redis write failed — not fatal, we still have the config
    }
    localCache.set(tenantId, config);

    return config;
  } catch (err) {
    console.error(`[tenant] Failed to load config for ${tenantId}:`, err);
    return null;
  }
}

/** Invalidate a tenant's cached config (call after updating in DB) */
export async function invalidateTenantCache(tenantId: string): Promise<void> {
  localCache.delete(tenantId);
  try {
    const r = getRedis();
    await r.del(TENANT_CACHE_PREFIX + tenantId);
  } catch {
    // Redis unavailable — local cache cleared is enough
  }
}

/** Seed a tenant config directly (for REPL / testing, skips DB) */
export function setTenantConfig(config: TenantConfig): void {
  localCache.set(config.tenantId, config);
}

// ── Token Usage Logging ─────────────────────────────────────────────────────
//
// Logs per-turn token usage to Postgres for cost attribution.
// Also checks daily limit.

/**
 * Log token usage for a tenant after an agent turn.
 * Non-blocking — errors are logged but don't break the response.
 */
export async function logTokenUsage(
  tenantId: string,
  sessionId: string,
  usage: TokenUsage,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO token_usage (tenant_id, session_id, prompt_tokens, completion_tokens, total_tokens)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, sessionId, usage.promptTokens, usage.completionTokens, usage.totalTokens],
    );
  } catch (err) {
    console.error(`[tenant] Failed to log token usage for ${tenantId}:`, err);
  }
}

/**
 * Get total tokens used by a tenant today.
 * Used to check against maxTokensPerDay.
 */
export async function getDailyTokenUsage(tenantId: string): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COALESCE(SUM(total_tokens), 0) as total
       FROM token_usage
       WHERE tenant_id = $1
         AND created_at >= CURRENT_DATE`,
      [tenantId],
    );
    return parseInt(result.rows[0].total, 10);
  } catch (err) {
    console.error(`[tenant] Failed to get daily usage for ${tenantId}:`, err);
    return 0; // fail open — don't block requests on DB errors
  }
}

// ── DB Schema Setup ─────────────────────────────────────────────────────────
//
// Run this once to create the required tables.

export async function ensureSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      tenant_id     TEXT PRIMARY KEY,
      system_prompt TEXT NOT NULL,
      max_tokens_per_day INTEGER DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS token_usage (
      id              SERIAL PRIMARY KEY,
      tenant_id       TEXT NOT NULL REFERENCES tenants(tenant_id),
      session_id      TEXT NOT NULL,
      prompt_tokens   INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      total_tokens    INTEGER NOT NULL,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_token_usage_tenant_date
      ON token_usage (tenant_id, created_at);

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
      role TEXT DEFAULT 'admin',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Add widget columns to tenants (idempotent)
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS llm_api_key_encrypted TEXT;
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS widget_token TEXT;
  `);

  // Seed demo users (idempotent — skips if email already exists)
  const demoUsers = [
    { email: "marius@posthog.com", password: "demo", name: "Marius Andra", tenantId: "posthog" },
    { email: "admin@acme.com", password: "demo", name: "Alex Chen", tenantId: "acme" },
  ];

  for (const user of demoUsers) {
    const hash = await Bun.password.hash(user.password);
    await pool.query(
      `INSERT INTO users (email, password_hash, name, tenant_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [user.email, hash, user.name, user.tenantId],
    );
  }

  // Seed widget tokens for demo tenants
  await pool.query(`UPDATE tenants SET widget_token = 'tk_posthog_demo' WHERE tenant_id = 'posthog' AND widget_token IS NULL`);
  await pool.query(`UPDATE tenants SET widget_token = 'tk_acme_demo' WHERE tenant_id = 'acme' AND widget_token IS NULL`);
}

export async function getTenantByWidgetToken(token: string): Promise<TenantConfig | null> {
  try {
    const result = await pool.query(
      `SELECT tenant_id, system_prompt, max_tokens_per_day, llm_api_key_encrypted
       FROM tenants WHERE widget_token = $1`,
      [token],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      tenantId: row.tenant_id,
      systemPrompt: row.system_prompt,
      maxTokensPerDay: row.max_tokens_per_day ?? 0,
    };
  } catch {
    return null;
  }
}

export async function getEncryptedApiKey(tenantId: string): Promise<string | null> {
  try {
    const result = await pool.query(
      `SELECT llm_api_key_encrypted FROM tenants WHERE tenant_id = $1`,
      [tenantId],
    );
    return result.rows[0]?.llm_api_key_encrypted || null;
  } catch {
    return null;
  }
}

export async function saveEncryptedApiKey(tenantId: string, encrypted: string): Promise<void> {
  await pool.query(
    `UPDATE tenants SET llm_api_key_encrypted = $1, updated_at = NOW() WHERE tenant_id = $2`,
    [encrypted, tenantId],
  );
}

export async function generateWidgetToken(tenantId: string): Promise<string> {
  const token = `tk_${tenantId}_${crypto.randomUUID().slice(0, 8)}`;
  await pool.query(
    `UPDATE tenants SET widget_token = $1, updated_at = NOW() WHERE tenant_id = $2`,
    [token, tenantId],
  );
  return token;
}
