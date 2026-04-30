import pg from "pg";
import { embedText } from "@helpdesk-ai/shared";
import type { DocChunk } from "@helpdesk-ai/types";

const DB_URL = process.env.DATABASE_URL || "postgresql://localhost:5432/helpdesk_ai";
const DEFAULT_TOP_K = 5;
// RRF constant — controls how much lower-ranked results are penalized.
// Standard value from the original RRF paper (Cormack et al., 2009).
const RRF_K = 60;

export interface RetrievedChunk extends DocChunk {
  similarity: number;
}

export interface RetrievalOptions {
  topK?: number;
  vectorWeight?: number;
  textWeight?: number;
}

/**
 * Hybrid retrieval: combines vector search (semantic) with full-text search (keyword/BM25-style).
 * Results are merged using weighted Reciprocal Rank Fusion (RRF).
 */
export async function retrieveChunks(
  query: string,
  tenantId: string,
  options: RetrievalOptions = {}
): Promise<RetrievedChunk[]> {
  const { topK = DEFAULT_TOP_K, vectorWeight = 0.5, textWeight = 0.5 } = options;

  const [queryEmbedding] = await embedText(query);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const client = new pg.Client(DB_URL);
  await client.connect();

  try {
    // Fetch more candidates than needed from each method so RRF has enough to work with
    const candidateLimit = topK * 4;

    // Run both searches in parallel
    const [vectorResults, textResults] = await Promise.all([
      // Semantic search: cosine similarity via pgvector
      client.query(
        `SELECT id, tenant_id, source_file, doc_title, section_path, content, doc_type,
                1 - (embedding <=> $1::vector) AS similarity
         FROM chunks
         WHERE tenant_id = $2
         ORDER BY embedding <=> $1::vector
         LIMIT $3`,
        [embeddingStr, tenantId, candidateLimit]
      ),
      // Keyword search: Postgres full-text search with ts_rank
      client.query(
        `SELECT id, tenant_id, source_file, doc_title, section_path, content, doc_type,
                ts_rank(search_vector, plainto_tsquery('english', $1)) AS text_rank
         FROM chunks
         WHERE tenant_id = $2
           AND search_vector @@ plainto_tsquery('english', $1)
         ORDER BY text_rank DESC
         LIMIT $3`,
        [query, tenantId, candidateLimit]
      ),
    ]);

    const fused = reciprocalRankFusion(
      vectorResults.rows,
      textResults.rows,
      topK,
      vectorWeight,
      textWeight
    );

    return fused;
  } finally {
    await client.end();
  }
}

/**
 * Reciprocal Rank Fusion: merges two ranked lists into one.
 * Each result gets score = weight * 1/(rank + 1 + k) from each list.
 * Results appearing in both lists get boosted.
 */
function reciprocalRankFusion(
  vectorRows: any[],
  textRows: any[],
  topK: number,
  vectorWeight: number,
  textWeight: number
): RetrievedChunk[] {
  const scoreMap = new Map<string, { chunk: any; score: number }>();

  vectorRows.forEach((row, rank) => {
    const rrfScore = vectorWeight * (1 / (rank + 1 + RRF_K));
    const existing = scoreMap.get(row.id);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scoreMap.set(row.id, { chunk: row, score: rrfScore });
    }
  });

  textRows.forEach((row, rank) => {
    const rrfScore = textWeight * (1 / (rank + 1 + RRF_K));
    const existing = scoreMap.get(row.id);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scoreMap.set(row.id, { chunk: row, score: rrfScore });
    }
  });

  return Array.from(scoreMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ chunk, score }) => ({
      id: chunk.id,
      tenant_id: chunk.tenant_id,
      source_file: chunk.source_file,
      doc_title: chunk.doc_title,
      section_path: chunk.section_path,
      content: chunk.content,
      doc_type: chunk.doc_type,
      similarity: score,
    }));
}
