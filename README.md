# helpdesk-ai

A production-grade, multi-tenant AI support agent built in TypeScript. Uses RAG (Retrieval-Augmented Generation) with hybrid search to answer questions from a documentation knowledge base.

Built as a learning project to deeply understand agent engineering — every architectural decision is documented in [`ayushnau-ops/LEARNING.md`](../ayushnau-ops/LEARNING.md).

---

## Architecture

```
helpdesk-ai/
├── apps/
│   ├── api/                  Hand-rolled agent (CLI REPL)
│   └── mastra-agent/         Mastra framework agent (CLI REPL)
├── packages/
│   ├── agent-core/           Agent loop, tool registry, provider abstraction, streaming
│   ├── retrieval/            Hybrid retrieval (vector + BM25), RRF fusion
│   ├── ingestion/            Doc parsing, chunking, embedding pipeline
│   ├── shared/               Shared utilities (embedText via Ollama)
│   ├── types/                Shared TypeScript types (DocChunk)
│   └── eval/                 Evaluation suite (planned)
└── data/
    └── chunks.json           Intermediate chunked docs (pre-embedding)
```

### Two agents, one retrieval pipeline

Both agents use the same `packages/retrieval/` pipeline underneath:

- **Hand-rolled** (`apps/api/`) — Custom agent loop with typed tool results, streaming via async generators, 5-category error handling. More control, better with local models.
- **Mastra** (`apps/mastra-agent/`) — Framework-based agent using `@mastra/core`. Less code, built-in memory support, but less visibility into the agent loop.

---

## RAG Pipeline

```
Markdown docs → Chunk (heading-based) → Embed (nomic-embed-text) → pgvector
                                                                        ↓
User query → Embed query → Vector search (cosine) ─┐
                         → Keyword search (tsvector) ─┤→ RRF fusion → Top-K chunks → LLM
```

### Hybrid retrieval

Combines two search methods via Reciprocal Rank Fusion (RRF):

- **Vector search** — Semantic similarity via pgvector (`embedding <=> query_vector`). Finds conceptually related content.
- **Keyword search** — Postgres full-text search (`tsvector` + `ts_rank`). Finds exact term matches. Pre-computed at ingestion time with GIN index.

Configurable weights (`vectorWeight`, `textWeight`) control the balance.

---

## Stack

- **TypeScript / Node.js / Bun** — Primary runtime
- **PostgreSQL + pgvector** — Vector storage and ANN search (HNSW index)
- **Ollama** — Local embedding (nomic-embed-text, 768-dim) and LLM inference
- **Mastra** — Optional agent framework (v1.30)
- **Zod** — Schema validation at tool boundaries

---

## Setup

### Prerequisites

- Bun (v1.2+)
- PostgreSQL 16 with pgvector extension
- Ollama with `nomic-embed-text` and `qwen3:8b` (or `qwen2.5:7b`)

### Install

```bash
cd helpdesk-ai
bun install
cp .env.example .env  # add your API keys
```

### Database setup

```sql
CREATE DATABASE helpdesk_ai;
\c helpdesk_ai
CREATE EXTENSION vector;

CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_file TEXT NOT NULL,
  doc_title TEXT NOT NULL,
  section_path TEXT NOT NULL,
  content TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  embedding vector(768),
  search_vector tsvector,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_chunks_tenant_id ON chunks(tenant_id);
CREATE INDEX idx_chunks_tenant_embedding ON chunks USING hnsw(embedding vector_cosine_ops) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_chunks_search_vector ON chunks USING gin(search_vector);
```

### Ingest docs

```bash
# Step 1: Parse and chunk markdown docs
bun run chunks

# Step 2: Embed chunks and insert into pgvector
bun run embed
```

---

## Running

```bash
# Hand-rolled agent (default: Ollama qwen2.5:7b)
bun run agent

# Hand-rolled with specific provider
bun run agent ollama qwen3:8b
bun run agent groq
bun run agent gemini

# Mastra agent (default: Ollama qwen3:8b)
bun run agent:mastra

# Search the knowledge base directly
bun run search "how to set up stripe"
bun run search "stripe webhook" posthog 5 0.3 0.7  # custom weights
```

### REPL commands

| Command  | What it does                                      |
| -------- | ------------------------------------------------- |
| `/clear` | Wipe conversation history (system prompt is kept) |
| `/quit`  | Exit cleanly                                      |
| `Ctrl-C` | Graceful shutdown                                 |

---

## Available tools

| Tool               | Description                                                        |
| ------------------ | ------------------------------------------------------------------ |
| `search_knowledge` | Hybrid RAG search over the documentation knowledge base            |
| `read_file`        | Read a file's contents (truncated at 50 KB)                        |
| `write_file`       | Create or overwrite a file                                         |
| `list_directory`   | List entries in a directory                                        |
| `search_text`      | Literal text search via `grep -rIn` (local files only)             |

The system prompt guides the LLM: use `search_knowledge` for product/docs questions, `search_text` only for local code files.

---

## Environment variables

| Variable                       | Required?             | Purpose                              |
| ------------------------------ | --------------------- | ------------------------------------ |
| `DATABASE_URL`                 | Optional              | Postgres connection (default: localhost) |
| `GROQ_API_KEY`                 | For `groq` provider   | Groq API auth                        |
| `GEMINI_API_KEY`               | For `gemini` provider | Gemini API auth                      |
| `GOOGLE_GENERATIVE_AI_API_KEY` | For Mastra + Gemini   | Mastra uses this env var name        |
| `MASTRA_MODEL`                 | Optional              | Mastra model (default: `ollama/qwen3:8b`) |
| `MASTRA_MODEL_URL`             | Optional              | Custom model endpoint URL            |

---

## License

ISC
