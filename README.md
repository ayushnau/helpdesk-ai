# helpdesk-ai

A production-grade, multi-tenant AI support agent built in TypeScript. Not a chatbot — a full agent system that searches your docs, reasons over them, and cites sources.

**[Live Demo](https://helpdesk-ai-web.onrender.com)** · **[Watch Video](https://www.loom.com/share/fd1f8fffe3954805923cc802c757ac33)** · **[Source Code](https://github.com/ayushnau/helpdesk-ai)**

---

## What it does

- **Tool-calling agent loop** — searches knowledge base, reasons over results, cites sources with references
- **Multi-tenant isolation** — each customer gets their own system prompt, knowledge base, token limits, and cost tracking
- **RAG pipeline** — upload markdown docs, auto-chunk by headings, hybrid search (vector + full-text), RRF fusion
- **Streaming responses** — SSE token-by-token streaming from LLM to browser
- **Admin dashboard** — real-time token usage, conversation transcripts, prompt editor with version history, knowledge base management
- **Per-tenant cost tracking** — daily token caps, usage breakdown by hour/day, cost attribution
- **Bring your own key** — users provide their own Gemini/Groq API key via the Settings UI

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Next.js 15)                      │
│  Landing page · Login/Signup · Dashboard · Chat (SSE streaming)  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP + SSE
┌──────────────────────────▼──────────────────────────────────────┐
│                     Hono API Server                              │
│  /auth/* · /chat · /chat/stream · /admin/* · /health             │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │              agent-core (agentTurnStream)                │     │
│  │  Provider abstraction · Tool registry · Memory/compress  │     │
│  │  Streaming via AsyncGenerator · Multi-tenant scoping     │     │
│  └─────────┬──────────────────────┬────────────────────────┘     │
│            │                      │                              │
│   ┌────────▼────────┐   ┌────────▼────────┐                     │
│   │  LLM Provider   │   │  search_knowledge│                     │
│   │  Gemini / Groq   │   │  (hybrid RAG)   │                     │
│   │  Ollama (local)  │   │  vector + BM25  │                     │
│   └─────────────────┘   └────────┬────────┘                     │
└──────────────────────────────────┼──────────────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────┐
        │                          │                   │
   ┌────▼─────┐            ┌──────▼──────┐     ┌─────▼─────┐
   │ Postgres  │            │   Redis     │     │  Postgres  │
   │ tenants   │            │ sessions    │     │  chunks    │
   │ users     │            │ (24h TTL)   │     │  (pgvector)│
   │ token_usage│           │ tenant cache│     │            │
   └───────────┘            └─────────────┘     └────────────┘
```

### Monorepo structure

```
helpdesk-ai/
├── apps/
│   ├── server/            Hono HTTP server (REST + SSE streaming)
│   ├── web/               Next.js 15 frontend (App Router)
│   └── api/               CLI REPL agent
├── packages/
│   ├── agent-core/        Agent loop, tools, providers, streaming, multi-tenancy
│   ├── retrieval/         Hybrid search (vector + BM25 + RRF fusion)
│   ├── ingestion/         Doc parsing, chunking, embedding pipeline
│   ├── shared/            Embedding utilities (Ollama / Gemini)
│   └── types/             Shared TypeScript types
├── data/
│   └── demo/              Demo markdown files for Acme tenant
└── docs/
    └── sequence-flows.md  Request lifecycle diagrams
```

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router), React 19, CSS custom properties |
| Backend | Hono, Bun |
| Database | PostgreSQL + pgvector (Supabase) |
| Cache | Redis (Upstash) |
| LLM | Gemini, Groq, Ollama (local) |
| Embeddings | Gemini text-embedding-004 / Ollama nomic-embed-text |
| Auth | bcrypt (Bun.password), localStorage sessions |
| Deployment | Render (Docker containers) |

---

## Features

### Agent loop
- Tool-calling with `search_knowledge` (RAG), `read_file`, `write_file`, `list_directory`, `search_text`
- Streaming via AsyncGenerator — single `agentTurnStream()` powers CLI, HTTP, and SSE
- Auto-continuation on truncated responses
- Structured error handling (5 error categories)
- Context window compression when approaching token limits

### Multi-tenancy
- Tenant-scoped knowledge base search (each tenant's docs are isolated)
- Per-tenant system prompts (editable via dashboard)
- Per-tenant daily token caps with hard limits
- Tenant config cached in Redis (1h TTL) with Postgres as source of truth
- User signup auto-creates a new tenant

### Dashboard
- **Overview** — real-time token usage (hourly/daily charts), active sessions, cost tracking
- **Prompt editor** — edit system prompt with split-view live preview, version history
- **Knowledge base** — upload .md/.mdx/.txt files, auto-chunk, view indexed documents
- **Conversations** — browse active + historical sessions, view full transcripts
- **Settings** — tenant config, daily limits, API key management, model selection

### Chat
- SSE streaming (token-by-token rendering)
- Debug sidebar (session ID, tenant, model, token count, tool calls, citations)
- Demo tenant switcher for unauthenticated users
- Markdown rendering with code blocks, lists, bold, inline citations

---

## Running locally

### Prerequisites

- Bun (v1.2+)
- PostgreSQL with pgvector extension
- Redis (or Upstash)
- Ollama with `nomic-embed-text` model (for local embeddings)

### Setup

```bash
git clone https://github.com/ayushnau/helpdesk-ai.git
cd helpdesk-ai
bun install
cp .env.example .env  # configure DATABASE_URL, REDIS_URL
```

### Database

```sql
CREATE DATABASE helpdesk_ai;
\c helpdesk_ai
CREATE EXTENSION vector;
```

The server runs `ensureSchema()` on startup which creates all tables and seeds demo tenants/users.

### Run

```bash
# Start the backend (default: Ollama)
bun run server

# Start with Gemini
bun run server gemini

# Start the frontend
bun run web:dev

# CLI agent (REPL)
bun run agent
```

### Ingest docs

```bash
bun run chunks    # Parse and chunk markdown docs
bun run embed     # Embed chunks and insert into pgvector
```

---

## Deployment

Deployed on Render with Supabase (Postgres) and Upstash (Redis).

```bash
# Backend: Hono server in Docker (Bun runtime)
# Frontend: Next.js standalone in Docker
# Config: render.yaml at repo root
```

Set these environment variables on the backend service:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Supabase pooler connection string |
| `REDIS_URL` | Upstash Redis URL (rediss://) |
| `LLM_PROVIDER` | `gemini` or `groq` |
| `CORS_ORIGINS` | Frontend URL (comma-separated) |

The frontend needs `NEXT_PUBLIC_API_URL` as a Docker build arg (baked at build time).

---

## Demo accounts

| Email | Password | Tenant |
|-------|----------|--------|
| marius@posthog.com | demo | PostHog |
| admin@acme.com | demo | Acme Corp |

Or sign up to create your own tenant.

---

## License

ISC

---

Built by [Ayush Nautiyal](https://ayushnau.github.io) · [Email](mailto:ayushnautiyaldevelopr@gmail.com) · [Twitter](https://x.com/Avicula11) · [LinkedIn](https://linkedin.com/in/ayush-nautiyal-947266177)
