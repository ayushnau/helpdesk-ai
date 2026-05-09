# Ingestion & Retrieval: Complete Deep Dive

This document explains the complete end-to-end flow of how documents get into the system and how they're retrieved at query time. It covers every step, the data transformations at each stage, the Postgres internals that make full-text search work, and what alternatives exist at each decision point.

---

## Table of Contents

- [1. Ingestion Pipeline](#1-ingestion-pipeline)
  - [1.1 Sequence Diagram](#11-sequence-diagram)
  - [1.2 Step-by-step walkthrough](#12-step-by-step-walkthrough)
  - [1.3 What gets stored in the DB](#13-what-gets-stored-in-the-db)
- [2. Retrieval Pipeline](#2-retrieval-pipeline)
  - [2.1 Sequence Diagram](#21-sequence-diagram)
  - [2.2 Step-by-step walkthrough](#22-step-by-step-walkthrough)
  - [2.3 Reciprocal Rank Fusion (RRF)](#23-reciprocal-rank-fusion-rrf)
- [3. Postgres Full-Text Search Internals](#3-postgres-full-text-search-internals)
  - [3.1 What is a tsvector?](#31-what-is-a-tsvector)
  - [3.2 What is a tsquery?](#32-what-is-a-tsquery)
  - [3.3 The @@ match operator](#33-the--match-operator)
  - [3.4 ts_rank scoring — how frequency is derived](#34-ts_rank-scoring--how-frequency-is-derived)
  - [3.5 GIN index — what it does and doesn't do](#35-gin-index--what-it-does-and-doesnt-do)
- [4. Postgres Vector Search Internals](#4-postgres-vector-search-internals)
  - [4.1 The embedding column](#41-the-embedding-column)
  - [4.2 HNSW index](#42-hnsw-index)
  - [4.3 Cosine distance operator](#43-cosine-distance-operator)
- [5. What We Could Have Done Differently](#5-what-we-could-have-done-differently)
  - [5.1 Chunking alternatives](#51-chunking-alternatives)
  - [5.2 Embedding alternatives](#52-embedding-alternatives)
  - [5.3 Full-text search improvements](#53-full-text-search-improvements)
  - [5.4 Retrieval strategy alternatives](#54-retrieval-strategy-alternatives)
  - [5.5 Fusion alternatives](#55-fusion-alternatives)

---

## 1. Ingestion Pipeline

### 1.0 One-time DB setup (before any ingestion runs)

This happens **once, manually**, when you set up the database. It is NOT part of the ingestion code — you ran these SQL statements yourself:

```sql
-- Enable pgvector extension
CREATE EXTENSION vector;

-- Create the table
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  ...
  embedding vector(768),        -- column that stores dense vectors
  search_vector tsvector,       -- column that stores stemmed lexeme lists
  ...
);

-- YOU explicitly create these indexes:
CREATE INDEX idx_chunks_tenant_id ON chunks(tenant_id);

-- HNSW index: makes vector similarity search O(log n) instead of O(n)
CREATE INDEX idx_chunks_tenant_embedding
  ON chunks USING hnsw(embedding vector_cosine_ops)
  WHERE tenant_id IS NOT NULL;

-- GIN index: makes the @@ text match operator use inverted index lookup instead of full table scan
-- THIS is where the inverted index (lexeme -> row list) structure is created.
-- Without this line, text search still WORKS but scans every row = unusable at scale.
CREATE INDEX idx_chunks_search_vector ON chunks USING gin(search_vector);
```

After this setup, every INSERT/UPDATE to the `chunks` table **automatically** updates both indexes. You don't manually maintain them — Postgres does it on every write. So when `embed.ts` inserts a row with an `embedding` and a `search_vector`, Postgres immediately:
- Adds the embedding to the HNSW graph
- Adds the tsvector's lexemes to the GIN inverted index

The indexes are created once. They're maintained automatically. The ingestion code doesn't know or care about them.

### 1.1 Sequence Diagram

```
                         INGESTION FLOW
                         ==============

  Markdown Files         ingest.ts              markdown.ts            Ollama              Postgres
  (on disk)              (orchestrator)         (parser)               (nomic-embed-text)  (pgvector + tsvector)
       |                      |                      |                      |                    |
       |  readdir/readFile    |                      |                      |                    |
       |--------------------->|                      |                      |                    |
       |   raw .md/.mdx text  |                      |                      |                    |
       |                      |  parseMarkdownFile() |                      |                    |
       |                      |--------------------->|                      |                    |
       |                      |                      |                      |                    |
       |                      |                      |--+                   |                    |
       |                      |                      |  | 1. Strip YAML frontmatter (gray-matter)
       |                      |                      |  | 2. Split at heading boundaries (regex)
       |                      |                      |  | 3. Skip headings inside code blocks
       |                      |                      |  | 4. Build heading hierarchy stack
       |                      |                      |  | 5. Split oversized sections (>4000 chars)
       |                      |                      |  |    - First try paragraph boundaries (\n\n)
       |                      |                      |  |    - Fallback to line boundaries (\n)
       |                      |                      |  | 6. Generate deterministic chunk ID
       |                      |                      |  |    (SHA-256 of sectionPath + content, first 16 hex chars)
       |                      |                      |<-+                   |                    |
       |                      |                      |                      |                    |
       |                      |  DocChunk[]          |                      |                    |
       |                      |<---------------------|                      |                    |
       |                      |                      |                      |                    |
       |                      |  Write chunks.json to disk                  |                    |
       |                      |--------------------->|                      |                    |
       |                      |                      |                      |                    |
       |                      |                                             |                    |
       |                      |       ===== embed.ts takes over =====      |                    |
       |                      |                                             |                    |
       |                      |  Load chunks.json from disk                 |                    |
       |                      |--+                                          |                    |
       |                      |  |                                          |                    |
       |                      |<-+                                          |                    |
       |                      |                                             |                    |
       |                      |  POST /api/embed (batch of 50 texts)        |                    |
       |                      |-------------------------------------------->|                    |
       |                      |                                             |                    |
       |                      |  number[][] (768-dim vectors per text)      |                    |
       |                      |<--------------------------------------------|                    |
       |                      |                                             |                    |
       |                      |  (repeat for all batches)                   |                    |
       |                      |                                             |                    |
       |                      |  INSERT INTO chunks (..., embedding, search_vector)              |
       |                      |  VALUES (..., $8, to_tsvector('english', title || ' ' || content))
       |                      |----------------------------------------------------------------->|
       |                      |                                             |                    |
       |                      |                                             |                    |--+
       |                      |                                             |                    |  | Postgres internally:
       |                      |                                             |                    |  | 1. Stores embedding as vector(768)
       |                      |                                             |                    |  | 2. Runs to_tsvector():
       |                      |                                             |                    |  |    - Tokenize text
       |                      |                                             |                    |  |    - Remove stopwords ("the", "is", "a")
       |                      |                                             |                    |  |    - Stem words ("processing" -> "process")
       |                      |                                             |                    |  |    - Record positions
       |                      |                                             |                    |  |    - Store as tsvector type
       |                      |                                             |                    |  | 3. Updates HNSW index (for embedding)
       |                      |                                             |                    |  | 4. Updates GIN index (for search_vector)
       |                      |                                             |                    |<-+
       |                      |                                             |                    |
       |                      |  RETURNING (xmax = 0) AS is_insert          |                    |
       |                      |<-----------------------------------------------------------------|
       |                      |                                             |                    |
       |                      |  (xmax = 0 means INSERT, else UPDATE — Postgres MVCC trick)     |
```

### 1.2 Step-by-step walkthrough

**Phase 1: Parse (ingest.ts + markdown.ts)**

1. `ingest.ts` recursively scans the docs directory for `.md`/`.mdx` files, skipping `_snippets` directories.
2. For each file, `parseMarkdownFile()` is called:
  - **Frontmatter extraction**: `gray-matter` separates YAML metadata (title, etc.) from content.
  - **Heading-based splitting**: A regex (`/^(#{1,6})\s+(.+)$/gm`) finds headings. Code block ranges are pre-computed so headings inside ``` fences are skipped.
  - **Heading hierarchy**: A stack tracks the current heading path. When an h2 appears, h3-h6 are cleared. This produces `section_path` like `"Stripe > Webhooks > Retry Logic"`.
  - **Oversized section splitting**: Sections over 4000 chars are split at paragraph boundaries first (`\n\n`), then line boundaries (`\n`) as fallback.
  - **Deterministic IDs**: `SHA-256(sectionPath + "\n" + content)` truncated to 16 hex chars. Same content = same ID, so re-runs do upserts instead of duplicates.
3. Output: `chunks.json` on disk — an array of `DocChunk` objects.

**Phase 2: Embed & Store (embed.ts)**

1. Load `chunks.json` from disk.
2. Batch chunks into groups of 50 and send to Ollama's `/api/embed` endpoint using `nomic-embed-text` model. Each text becomes a 768-dimensional float vector.
3. Insert into Postgres in batches of 50 within transactions:
  - The embedding is formatted as a string `'[0.1, 0.2, ...]'` for pgvector.
  - The `search_vector` is computed inline: `to_tsvector('english', doc_title || ' ' || content)`.
  - `ON CONFLICT (id) DO UPDATE` makes the operation idempotent — re-runs update existing rows.
  - `RETURNING (xmax = 0) AS is_insert` is a Postgres MVCC trick: if the row was freshly inserted, `xmax` (the transaction ID that deleted/updated this row version) is 0.

### 1.3 What gets stored in the DB

```sql
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,                -- SHA-256 hash (first 16 hex chars)
  tenant_id TEXT NOT NULL,            -- e.g. "posthog"
  source_file TEXT NOT NULL,          -- relative path to original .md file
  doc_title TEXT NOT NULL,            -- from frontmatter or derived from filename
  section_path TEXT NOT NULL,         -- e.g. "Stripe > Webhooks > Retry Logic"
  content TEXT NOT NULL,              -- the actual chunk text
  doc_type TEXT NOT NULL,             -- "docs" or "handbook"
  embedding vector(768),              -- 768-dim float vector from nomic-embed-text
  search_vector tsvector,             -- pre-computed stemmed token list with positions
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes:
CREATE INDEX idx_chunks_tenant_id ON chunks(tenant_id);
CREATE INDEX idx_chunks_tenant_embedding ON chunks USING hnsw(embedding vector_cosine_ops)
  WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_chunks_search_vector ON chunks USING gin(search_vector);
```

Two columns serve retrieval:

- `embedding` — the semantic meaning of the chunk as a dense vector
- `search_vector` — the keyword/lexeme representation as a sparse, pre-computed tsvector

Both are indexed. Both operate on the same rows in the same table.

---

## 2. Retrieval Pipeline

### 2.1 Sequence Diagram

```
                         RETRIEVAL FLOW (High-Level)
                         ===========================

  User Query             retrieve.ts            Ollama              Postgres
       |                      |                      |                    |
       |  "how do I retry     |                      |                    |
       |   failed webhooks?"  |                      |                    |
       |--------------------->|                      |                    |
       |                      |                      |                    |
       |                      |  POST /api/embed     |                    |
       |                      |  { input: query }    |                    |
       |                      |--------------------->|                    |
       |                      |                      |                    |
       |                      |  [0.12, -0.03, ...]  |                    |
       |                      |  (768-dim vector)    |                    |
       |                      |<---------------------|                    |
       |                      |                      |                    |
       |                      |                                           |
       |                      |===== Promise.all: two queries in parallel =====
       |                      |                                           |
       |                      |-- QUERY 1 (vector) ---------------------->|
       |                      |-- QUERY 2 (text)   ---------------------->|
       |                      |                                           |
       |                      |<-- vectorResults (20 rows) ---------------|
       |                      |<-- textResults (up to 20 rows) ----------|
       |                      |                                           |
       |                      |--+                                        |
       |                      |  | RRF fusion                             |
       |                      |  | (merge two lists by rank)              |
       |                      |<-+                                        |
       |                      |                                           |
       |  RetrievedChunk[5]   |                                           |
       |<---------------------|                                           |
```

**Below: what happens inside each query in detail.**

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                  QUERY 1: VECTOR SEARCH                         │
  │                                                                 │
  │  SQL sent to Postgres:                                          │
  │  ┌───────────────────────────────────────────────────────────┐  │
  │  │ SELECT ..., 1 - (embedding <=> $1::vector) AS similarity  │  │
  │  │ FROM chunks                                               │  │
  │  │ WHERE tenant_id = $2                                      │  │
  │  │ ORDER BY embedding <=> $1::vector                         │  │
  │  │ LIMIT 20                                                  │  │
  │  └───────────────────────────────────────────────────────────┘  │
  │                                                                 │
  │  What Postgres does internally:                                 │
  │                                                                 │
  │  Step 1: HNSW index traversal                                   │
  │  ┌─────────────────────────────────────────────────────────┐    │
  │  │ The query vector [0.12, -0.03, ...] enters the HNSW     │    │
  │  │ graph at the top layer. It hops between nodes (chunks)  │    │
  │  │ following edges to neighbors that are closer in cosine  │    │
  │  │ distance. At each layer it descends, the graph gets     │    │
  │  │ denser and the search gets more precise.                │    │
  │  │                                                         │    │
  │  │ Result: ~20 approximate nearest neighbor chunk IDs      │    │
  │  └─────────────────────────────────────────────────────────┘    │
  │                                                                 │
  │  Step 2: Compute exact similarity                               │
  │  ┌─────────────────────────────────────────────────────────┐    │
  │  │ For each candidate: similarity = 1 - cosine_distance    │    │
  │  │   chunk_42: 1 - 0.13 = 0.87                            │    │
  │  │   chunk_17: 1 - 0.21 = 0.79                            │    │
  │  │   chunk_99: 1 - 0.25 = 0.75                            │    │
  │  │   ...                                                   │    │
  │  └─────────────────────────────────────────────────────────┘    │
  │                                                                 │
  │  Step 3: Sort by similarity DESC, return top 20                 │
  │                                                                 │
  │  Output: vectorResults = [chunk_42, chunk_17, chunk_99, ...]    │
  └─────────────────────────────────────────────────────────────────┘


  ┌─────────────────────────────────────────────────────────────────┐
  │                  QUERY 2: TEXT SEARCH                            │
  │                                                                 │
  │  SQL sent to Postgres:                                          │
  │  ┌───────────────────────────────────────────────────────────┐  │
  │  │ SELECT ..., ts_rank(search_vector,                        │  │
  │  │   plainto_tsquery('english', $1)) AS text_rank            │  │
  │  │ FROM chunks                                               │  │
  │  │ WHERE tenant_id = $2                                      │  │
  │  │   AND search_vector @@ plainto_tsquery('english', $1)     │  │
  │  └───────────────────────────────────────────────────────────┘  │
  │                                                                 │
  │  What Postgres does internally:                                 │
  │                                                                 │
  │  Step 1: Parse the query with plainto_tsquery()                 │
  │  ┌─────────────────────────────────────────────────────────┐    │
  │  │ Input:  "how do I retry failed webhooks?"               │    │
  │  │                                                         │    │
  │  │ Processing:                                             │    │
  │  │   "how"      → removed (stopword)                       │    │
  │  │   "do"       → removed (stopword)                       │    │
  │  │   "I"        → removed (stopword)                       │    │
  │  │   "retry"    → stemmed to 'retri'                       │    │
  │  │   "failed"   → stemmed to 'fail'                        │    │
  │  │   "webhooks" → stemmed to 'webhook'                     │    │
  │  │                                                         │    │
  │  │ Output: 'retri' & 'fail' & 'webhook'                   │    │
  │  │         (all terms AND'd together)                      │    │
  │  └─────────────────────────────────────────────────────────┘    │
  │                                                                 │
  │  Step 2: GIN index lookup (the @@ operator)                     │
  │  ┌─────────────────────────────────────────────────────────┐    │
  │  │ The GIN index is an inverted index:                     │    │
  │  │   lexeme → list of rows containing that lexeme          │    │
  │  │                                                         │    │
  │  │ Look up each query lexeme:                              │    │
  │  │   'retri'   → [row3, row7, row12]                       │    │
  │  │   'fail'    → [row3, row5, row7]                        │    │
  │  │   'webhook' → [row3, row7, row20]                       │    │
  │  │                                                         │    │
  │  │ Because the query uses & (AND), INTERSECT the lists:    │    │
  │  │   [row3, row7, row12] ∩ [row3, row5, row7]             │    │
  │  │                       ∩ [row3, row7, row20]             │    │
  │  │   = [row3, row7]                                        │    │
  │  │                                                         │    │
  │  │ Only row3 and row7 contain ALL three lexemes.           │    │
  │  └─────────────────────────────────────────────────────────┘    │
  │                                                                 │
  │  Step 3: ts_rank() scoring on matched rows ONLY                 │
  │  ┌─────────────────────────────────────────────────────────┐    │
  │  │ For each matched row, read its stored tsvector and      │    │
  │  │ count how many positions each query lexeme has:         │    │
  │  │                                                         │    │
  │  │ row3's tsvector:                                        │    │
  │  │   'fail':2  'retri':7,15  'webhook':1,4,6              │    │
  │  │   → 'retri' appears 2x, 'fail' 1x, 'webhook' 3x       │    │
  │  │   → ts_rank combines these frequencies into a score     │    │
  │  │   → score = 0.42                                        │    │
  │  │                                                         │    │
  │  │ row7's tsvector:                                        │    │
  │  │   'fail':3  'retri':9  'webhook':1                      │    │
  │  │   → 'retri' 1x, 'fail' 1x, 'webhook' 1x               │    │
  │  │   → score = 0.28                                        │    │
  │  │                                                         │    │
  │  │ (Note: ts_rank does NOT consider how rare these terms   │    │
  │  │  are across the corpus — no IDF. Just raw frequency.)   │    │
  │  └─────────────────────────────────────────────────────────┘    │
  │                                                                 │
  │  Step 4: Sort by text_rank DESC, return top 20                  │
  │                                                                 │
  │  Output: textResults = [row3 (0.42), row7 (0.28)]               │
  └─────────────────────────────────────────────────────────────────┘


  ┌─────────────────────────────────────────────────────────────────┐
  │              FUSION: Reciprocal Rank Fusion (RRF)               │
  │                                                                 │
  │  Inputs:                                                        │
  │    vectorResults = [chunk_42, chunk_17, chunk_99, ...]  (rank 0, 1, 2...)
  │    textResults   = [row3, row7]                         (rank 0, 1)
  │                                                                 │
  │  Formula: rrfScore = weight * 1/(rank + 1 + k)   where k=60    │
  │                                                                 │
  │  Score each chunk from vectorResults (weight=0.5):              │
  │    chunk_42: 0.5 * 1/(0+1+60) = 0.00820                        │
  │    chunk_17: 0.5 * 1/(1+1+60) = 0.00806                        │
  │    chunk_99: 0.5 * 1/(2+1+60) = 0.00794                        │
  │    ...                                                          │
  │                                                                 │
  │  Score each chunk from textResults (weight=0.5):                │
  │    row3:     0.5 * 1/(0+1+60) = 0.00820                        │
  │    row7:     0.5 * 1/(1+1+60) = 0.00806                        │
  │                                                                 │
  │  If a chunk appears in BOTH lists, scores are SUMMED:           │
  │    e.g. if chunk_42 IS row3:                                    │
  │      combined = 0.00820 + 0.00820 = 0.01640  (boosted!)        │
  │                                                                 │
  │  Sort all chunks by combined score DESC                         │
  │  Return top 5                                                   │
  └─────────────────────────────────────────────────────────────────┘
```

### 2.2 Step-by-step walkthrough

1. **Embed the query**: The user's natural language query is sent to the same `nomic-embed-text` model used at ingestion. This is critical — query and document embeddings must come from the same model for cosine similarity to be meaningful.
2. **Two parallel searches** (`Promise.all`):
  **Vector search (semantic)**:
  - `embedding <=> $1::vector` computes cosine distance between the query embedding and every chunk's embedding.
  - `1 - distance` converts to similarity (1.0 = identical, 0.0 = orthogonal).
  - The HNSW index makes this sub-linear — it doesn't scan every row.
  - Returns `topK * 4` candidates (over-fetch so RRF has enough to work with).
   **Text search (keyword)**:
  - `plainto_tsquery('english', query)` normalizes the query: removes stopwords, stems words, ANDs them together.
  - `search_vector @@ tsquery` filters to only matching rows (via GIN index).
  - `ts_rank()` scores each matched row based on term frequency within that row's tsvector.
  - Returns up to `topK * 4` candidates.
3. **Reciprocal Rank Fusion**: Merges the two ranked lists (see section 2.3).
4. **Return top K**: Default 5 chunks, each with a fused similarity score.

### 2.3 Reciprocal Rank Fusion (RRF)

RRF is a rank-based fusion method. It doesn't care about the raw scores from each search — only the **rank position**.

**Formula**: `score = weight * 1 / (rank + 1 + k)`

- `k = 60` (from the original Cormack et al. 2009 paper). This constant dampens the difference between ranks — rank 1 vs rank 2 is a small difference, not a 2x difference.
- `weight` defaults to 0.5 for both vector and text, making them equally important.

**Why rank-based, not score-based?** Vector similarity scores (0.0–1.0) and ts_rank scores (arbitrary floats) are on completely different scales. You can't meaningfully add `0.87 similarity + 3.2 ts_rank`. RRF sidesteps this by only using ordinal positions.

**Boost for overlap**: If a chunk appears in BOTH the vector and text result lists, its RRF scores are summed. This is the key insight — a chunk that's both semantically relevant AND contains the exact keywords is almost certainly a good result.

**Example**:

```
Vector results: [chunkA (rank 0), chunkB (rank 1), chunkC (rank 2)]
Text results:   [chunkB (rank 0), chunkD (rank 1), chunkA (rank 2)]

chunkA: 0.5 * 1/(0+1+60) + 0.5 * 1/(2+1+60) = 0.00820 + 0.00794 = 0.01614
chunkB: 0.5 * 1/(1+1+60) + 0.5 * 1/(0+1+60) = 0.00806 + 0.00820 = 0.01626  <-- wins (in both lists)
chunkC: 0.5 * 1/(2+1+60)                     = 0.00794
chunkD: 0.5 * 1/(1+1+60)                     = 0.00806
```

---

## 3. Postgres Full-Text Search Internals

### 3.1 What is a tsvector?

A `tsvector` is a sorted list of **lexemes** (normalized word roots) with their **positions** in the original text.

```sql
SELECT to_tsvector('english', 'The Stripe API handles payment processing');
-- Result: 'api':3 'handl':4 'payment':5 'process':6 'stripe':2
```

What happened:

- **"The"** — removed (English stopword)
- **"Stripe"** — lowercased to "stripe", kept at position 2
- **"API"** — lowercased to "api", kept at position 3
- **"handles"** — stemmed to "handl", position 4
- **"payment"** — kept (already a root), position 5
- **"processing"** — stemmed to "process", position 6

**Key insight**: The numbers are **positions**, not frequencies. Frequency is derived from the count of positions:

```sql
SELECT to_tsvector('english', 'payment failed. check payment status. payment retry logic');
-- Result: 'check':3 'fail':2 'logic':8 'payment':1,4,6 'retri':7 'status':5
```

`'payment':1,4,6` — three positions means the word appeared 3 times. **The position list IS the frequency data.**

### 3.2 What is a tsquery?

A `tsquery` is the query-side counterpart. It represents the search terms after normalization, connected by boolean operators.

Three ways to create one:


| Function               | Input                    | Output                               | Behavior                                                   |
| ---------------------- | ------------------------ | ------------------------------------ | ---------------------------------------------------------- |
| `plainto_tsquery`      | `'Stripe webhook retry'` | `'stripe' & 'webhook' & 'retri'`     | AND all terms. Order doesn't matter. **We use this.**      |
| `phraseto_tsquery`     | `'Stripe webhook retry'` | `'stripe' <-> 'webhook' <-> 'retri'` | Terms must be adjacent and in order. Very strict.          |
| `websearch_to_tsquery` | `'Stripe webhook retry'` | `'stripe' & 'webhook' & 'retri'`     | Supports `"quotes"`, `OR`, `-exclude`. Google-like syntax. |


`websearch_to_tsquery` would be the best choice for user-facing search (supports negation like `stripe -billing`), but `plainto_tsquery` is the safe default for programmatic use.

### 3.3 The @@ match operator

`@@` checks: does this document's tsvector contain all the lexemes required by the tsquery?

```sql
-- Does this document match the query?
search_vector @@ plainto_tsquery('english', 'webhook retry')
```

This is a **boolean filter** — yes/no. It does NOT score. Scoring is done separately by `ts_rank()`.

The GIN index accelerates this operator specifically.

### 3.4 ts_rank scoring — how frequency is derived

`ts_rank(search_vector, tsquery)` scores a matched document. Here's what it does:

1. For each query lexeme, look up how many positions it has in the document's tsvector.
2. More positions = higher term frequency = higher score.
3. Optionally normalizes by document length (controlled by a normalization flag — we don't set one, so it uses raw frequency).

**What ts_rank is NOT**: It is NOT BM25. Key differences:


|                                                      | ts_rank               | BM25                                        |
| ---------------------------------------------------- | --------------------- | ------------------------------------------- |
| Term frequency within same document                  | Yes (linear count)    | Yes (with saturation — diminishing returns) |
| Inverse document frequency across different document | **No**                | Yes — rare terms score higher               |
| Document length normalization                        | Optional (flag-based) | Built-in                                    |


This means ts_rank treats "the" and "idempotency" equally if they appear the same number of times. BM25 would heavily boost "idempotency" because it's rare across the corpus.

### 3.5 GIN index — what it does and doesn't do

**GIN (Generalized Inverted Index)** maps each lexeme to the list of rows that contain it:

```
Internal structure:
  'api'     -> [row1, row5, row12]
  'handl'   -> [row1, row3]
  'payment' -> [row1, row3, row5, row7, row9]
  'stripe'  -> [row1, row5]
  ...
```

**What it speeds up**: The `@@` match operator. When you query `'stripe' & 'webhook'`, Postgres looks up both lexemes in the GIN index, intersects the row lists, and returns only matching rows — without scanning the full table.

**What it does NOT help with**: `ts_rank()` scoring. After the GIN index narrows down the candidate rows, Postgres reads each row's actual `tsvector` data to count positions and compute the score. The GIN index plays no role in scoring.

**Query execution flow**:

```
1. GIN index -> which rows match? (fast lookup)
2. Read tsvector column of matched rows -> compute ts_rank (per-row scoring)
3. Sort by ts_rank DESC
4. LIMIT N
```

---

## 4. Postgres Vector Search Internals

### 4.1 The embedding column

```sql
embedding vector(768)
```

Stores a 768-dimensional float vector. pgvector is a Postgres extension that adds the `vector` type and distance operators.

The embedding is a dense numerical representation of the chunk's semantic meaning, produced by `nomic-embed-text`. Two chunks about "retrying failed payments" would have similar embeddings even if they use completely different words.

### 4.2 HNSW index

```sql
CREATE INDEX idx_chunks_tenant_embedding
  ON chunks USING hnsw(embedding vector_cosine_ops)
  WHERE tenant_id IS NOT NULL;
```

HNSW (Hierarchical Navigable Small World) is a graph-based approximate nearest neighbor (ANN) index.

- **How it works**: Builds a multi-layer graph where each node is a vector. Upper layers have long-range connections (for fast traversal), lower layers have short-range connections (for precision). Query traversal starts at the top layer and descends.
- **"Approximate"**: It may miss the absolute closest vector in exchange for being O(log n) instead of O(n). The recall is typically >95%.
- `**vector_cosine_ops`**: Tells the index to use cosine distance for comparisons.
- **Partial index** (`WHERE tenant_id IS NOT NULL`): Only indexes rows that have a tenant_id, which is all real data.

### 4.3 Cosine distance operator

```sql
embedding <=> $1::vector  -- cosine distance (0 = identical, 2 = opposite)
1 - (embedding <=> $1::vector)  -- cosine similarity (1 = identical, -1 = opposite)
```

Cosine distance measures the angle between two vectors, ignoring magnitude. Two vectors pointing in the same direction have distance 0, regardless of their lengths.

Why cosine over Euclidean (L2)? Cosine is magnitude-invariant — a long document and a short document about the same topic will have similar cosine similarity, even if L2 distance is large due to different vector magnitudes.

---

## 5. What We Could Have Done Differently

### 5.1 Chunking alternatives

**What we do**: Heading-based splitting with a 4000-char max, paragraph/line fallback for oversized sections.

**Alternatives**:


| Strategy                                              | How it works                                                                     | Tradeoff                                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Fixed-size token chunks**                           | Split every N tokens with M-token overlap                                        | Simple, predictable size. Loses section boundaries — a chunk might start mid-paragraph. |
| **Semantic chunking**                                 | Use embedding similarity between adjacent sentences to find natural break points | Better chunk boundaries. Expensive (embed every sentence at ingestion).                 |
| **Recursive character splitting** (LangChain default) | Try splitting at `\n\n`, then `\n`, then `.` , then `` until under size limit    | More granular than heading-based. Doesn't preserve heading hierarchy metadata.          |
| **Parent-child chunking**                             | Store small chunks for retrieval but attach parent (larger context) for LLM      | Best of both worlds. More complex schema, more storage.                                 |
| **Agentic chunking**                                  | Use an LLM to decide chunk boundaries                                            | Most accurate. Extremely expensive at ingestion time.                                   |


**Why our choice is reasonable**: Heading-based splitting preserves document structure and gives us `section_path` metadata for free. The 4000-char limit respects nomic-embed-text's 8192-token context window. The paragraph fallback handles edge cases (tables, long code blocks).

**What we're missing**: No overlap between chunks. If a concept spans a heading boundary, we lose context. Parent-child chunking would fix this.

### 5.2 Embedding alternatives

**What we do**: `nomic-embed-text` via local Ollama, 768-dim vectors.

**Alternatives**:


| Model                             | Dimensions | Where it runs  | Tradeoff                                                              |
| --------------------------------- | ---------- | -------------- | --------------------------------------------------------------------- |
| `nomic-embed-text` (ours)         | 768        | Local (Ollama) | Free, private, decent quality. Slower than API.                       |
| `text-embedding-3-small` (OpenAI) | 1536       | API            | Higher quality, fast. Costs money (~$0.02/1M tokens). Vendor lock-in. |
| `text-embedding-3-large` (OpenAI) | 3072       | API            | Best quality. Higher cost, larger index.                              |
| `voyage-3` (Voyage AI)            | 1024       | API            | Excellent for code/technical docs.                                    |
| `cohere-embed-v3`                 | 1024       | API            | Supports compression to binary embeddings for cheaper storage.        |


**Production consideration**: In a real multi-tenant system, you'd likely use an API-based model (faster, no GPU needed on your server) and pass the cost to tenants. Local Ollama is great for development but adds infra complexity in production.

### 5.3 Full-text search improvements

**What we do**: Flat `to_tsvector('english', doc_title || ' ' || content)` with `ts_rank`.

**What we could add**:

**1. Weighted tsvectors (A/B/C/D labels)**

```sql
-- Instead of flat concatenation:
to_tsvector('english', doc_title || ' ' || content)

-- Use weight labels:
setweight(to_tsvector('english', doc_title), 'A') ||
setweight(to_tsvector('english', content), 'B')
```

This makes title matches score higher than body matches in `ts_rank`. Weight A is the highest priority, D is the lowest.

**2. Actual BM25 ranking**

- `ts_rank` doesn't do IDF (inverse document frequency). A word appearing in every document scores the same as a rare word.
- Options: ParadeDB's `pg_search` extension provides real BM25. Or compute IDF manually with a subquery. Or use Elasticsearch alongside Postgres.

**3. Better tsquery function**

- Switch from `plainto_tsquery` to `websearch_to_tsquery` for user-facing search — supports negation (`-term`), phrases (`"exact phrase"`), and OR.

**4. Trigram indexing** (`pg_trgm`)

- For fuzzy matching and typo tolerance. Full-text search only matches exact lexemes — "pymnt" won't match "payment". Trigram indexes handle this.

### 5.4 Retrieval strategy alternatives

**What we do**: Hybrid retrieval (vector + keyword) with RRF fusion.

**Alternatives**:


| Strategy                       | How it works                                                         | When to use                                                                               |
| ------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Vector only**                | Just cosine similarity                                               | When queries are always natural language and exact terms don't matter                     |
| **Keyword only**               | Just full-text search                                                | When users search for specific error codes, API names, exact phrases                      |
| **Hybrid (ours)**              | Both, fused with RRF                                                 | Best general-purpose approach — covers both semantic and lexical matching                 |
| **Hybrid + re-ranker**         | Run a cross-encoder model on top-N candidates to re-score            | Higher accuracy. Adds latency (cross-encoder is slow). Worth it for large candidate sets. |
| **Hybrid + HyDE**              | Generate a hypothetical answer, embed THAT, use it for vector search | Better retrieval for question-style queries. Adds an LLM call before search.              |
| **Multi-query retrieval**      | Rephrase the query 3-5 ways, run all, deduplicate                    | Covers more semantic angles. 3-5x the search cost.                                        |
| **ColBERT / late interaction** | Token-level similarity instead of whole-document embedding           | Much better precision. Requires specialized infra (ColBERT server).                       |


### 5.5 Fusion alternatives

**What we do**: Weighted RRF with k=60.

**Alternatives**:


| Method                                     | How it works                                                        | Tradeoff                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **RRF (ours)**                             | `1/(rank + k)` per list, sum for overlap                            | Simple, robust, rank-based (no score normalization needed)                           |
| **Convex Combination (CC)**                | `alpha * vector_score + (1-alpha) * text_score`                     | Requires score normalization (min-max or z-score). Sensitive to score distributions. |
| **Distribution-Based Score Fusion (DBSF)** | Normalize scores using their statistical distribution, then combine | More principled than CC. Requires computing mean/std of each score set.              |
| **Learned fusion**                         | Train a small model to learn optimal weights                        | Best accuracy. Requires training data. Overkill for our scale.                       |


**Why RRF is the right default**: It's simple, requires no score normalization, and the k=60 constant has been validated across many benchmarks. The main downside is that it discards the actual similarity scores — a chunk at rank 1 with 0.99 similarity and one at rank 1 with 0.51 similarity are treated identically.

---

## Summary: The Two Columns That Power Everything

```
                    chunks table
                    ============

  ┌─────────────────────────────────────────────────────────┐
  │  id | tenant_id | content | ... | embedding | search_vector  │
  │                                     │              │         │
  │                                     │              │         │
  │                              vector(768)      tsvector       │
  │                              dense floats     sparse lexemes │
  │                                     │              │         │
  │                                HNSW index      GIN index     │
  │                              (graph-based)   (inverted)      │
  │                                     │              │         │
  │                              cosine <=>       @@ match       │
  │                              similarity       ts_rank        │
  │                                     │              │         │
  │                              "what does it    "does it       │
  │                               mean?"           contain       │
  │                                               these words?"  │
  └─────────────────────────────────────────────────────────┘
                                     │              │
                                     └──────┬───────┘
                                            │
                                    Reciprocal Rank Fusion
                                            │
                                     Final ranked results
```

The entire system boils down to: **store two representations of each chunk at ingestion time, query both in parallel at retrieval time, fuse the ranked results.**