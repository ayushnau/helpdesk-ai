# Sequence Flows

## 1. Chat Message (POST /chat)

```
Browser → Hono Server → Redis → LLM → Postgres

1. Browser sends POST /chat with X-Tenant-ID, X-Session-ID, { message }
2. Server loads session from Redis (session:{sessionId}) or creates new
3. Server saves session immediately (user msg added) so it appears in conversations list
4. Server calls agentTurn(ctx, provider):
   a. Builds messages array (system prompt + history + new user msg)
   b. Sends to LLM (Groq/Gemini/Ollama via OpenAI-compat API)
   c. If LLM returns tool_calls → executes search_knowledge_base:
      - Queries Postgres chunks table (vector similarity + full-text)
      - Feeds results back to LLM for final response
   d. Returns { text, turnTokens }
5. Server saves session again to Redis (now includes assistant response)
6. Server logs token usage to Postgres (token_usage table)
7. Returns JSON { response, tokenUsage: { turn, session } }
```

**Storage:**
- Redis: `session:{id}` → full conversation state (messages, tokenUsage), 24h TTL
- Postgres: `token_usage` → one row per turn for billing/analytics
- Postgres: `tenants` → system prompt, daily limit (cached in Redis 1h)

## 2. Dashboard Token Usage (GET /admin/usage)

```
Browser → Hono Server → Postgres

1. Sidebar polls GET /admin/usage?tenant_id=X every 30s
2. Server queries: SUM(total_tokens) FROM token_usage WHERE tenant_id=X AND today
3. Also queries hourly breakdown for the chart
4. Returns { todayTotal, hourly[], daily[] }
```

## 3. Conversations List (GET /admin/sessions)

```
Browser → Hono Server → Redis + Postgres

1. Conversations page polls GET /admin/sessions?tenant_id=X
2. Server scans Redis keys (session:*), filters by tenantId → active sessions
3. Server queries Postgres token_usage grouped by session_id → historical sessions
4. Merges both, deduplicates, returns { sessions[] } with source: "redis"|"postgres"
```

## 4. Knowledge Upload (POST /admin/knowledge/upload)

```
Browser → Hono Server → Postgres

1. User selects .md/.mdx/.txt files via file picker
2. Browser sends multipart form (tenant_id + files)
3. Server chunks each file by headings (~1500 chars per chunk)
4. Inserts chunks into Postgres (content + full-text search vector, no embedding)
5. User clicks "Re-index all" to generate vector embeddings via Ollama
```

## 5. Tenant Config Update (PUT /admin/tenant)

```
Browser → Hono Server → Postgres → Redis (invalidate)

1. Admin updates system prompt or daily limit
2. Server UPDATE tenants SET ... WHERE tenant_id=X
3. Server invalidates Redis cache (DEL tenant:config:X)
4. Next chat request loads fresh config from Postgres, re-caches in Redis
```
