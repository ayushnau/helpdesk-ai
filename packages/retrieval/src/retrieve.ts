import pg from "pg";
import { embedText } from "@helpdesk-ai/shared";
import type { DocChunk } from "@helpdesk-ai/types";

const DB_URL = process.env.DATABASE_URL || "postgresql://localhost:5432/helpdesk_ai";
const DEFAULT_TOP_K = 5;

export interface RetrievedChunk extends DocChunk {
  similarity: number;
}

/**
 * Embed a query and retrieve the top-K most similar chunks for a tenant.
 * Returns chunks sorted by similarity (highest first).
 */
export async function retrieveChunks(
  query: string,
  tenantId: string,
  topK: number = DEFAULT_TOP_K
): Promise<RetrievedChunk[]> {
  // Step 1: embed the query into a vector
  const [queryEmbedding] = await embedText(query);
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  // Step 2: query pgvector for nearest neighbors, scoped to tenant
  const client = new pg.Client(DB_URL);
  await client.connect();

  try {
    const result = await client.query(
      `SELECT id, tenant_id, source_file, doc_title, section_path, content, doc_type,
              1 - (embedding <=> $1::vector) AS similarity
       FROM chunks
       WHERE tenant_id = $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [embeddingStr, tenantId, topK]
    );

    return result.rows as RetrievedChunk[];
  } finally {
    await client.end();
  }
}
