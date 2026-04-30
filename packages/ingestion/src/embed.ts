import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import type { DocChunk } from "@helpdesk-ai/types";
import { embedText } from "@helpdesk-ai/shared";

// --- Configuration ---
const CHUNKS_PATH = join(import.meta.dirname, "../../..", "data/chunks.json");
const DB_URL = process.env.DATABASE_URL || "postgresql://localhost:5432/helpdesk_ai";

// How many chunks to embed in one Ollama call.
const EMBED_BATCH_SIZE = 50;

// How many rows to insert in one DB transaction.
const INSERT_BATCH_SIZE = 50;

async function main() {
  // Step 1: Load chunks
  const raw = await readFile(CHUNKS_PATH, "utf-8");
  const chunks: DocChunk[] = JSON.parse(raw);
  console.log(`Loaded ${chunks.length} chunks from ${CHUNKS_PATH}\n`);

  // Step 2: Embed all chunks in batches
  console.log(`Embedding chunks (batch size: ${EMBED_BATCH_SIZE})...`);
  const embeddings = await embedAllChunks(chunks);
  console.log(`Embedded ${embeddings.length} chunks\n`);

  // Step 3: Insert into Postgres
  console.log(`Inserting into database...`);
  const client = new pg.Client(DB_URL);
  await client.connect();

  try {
    let inserted = 0;
    let updated = 0;

    // Process in batches to avoid huge single transactions
    for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
      const batchChunks = chunks.slice(i, i + INSERT_BATCH_SIZE);
      const batchEmbeddings = embeddings.slice(i, i + INSERT_BATCH_SIZE);

      const result = await insertBatch(client, batchChunks, batchEmbeddings);
      inserted += result.inserted;
      updated += result.updated;

      const progress = Math.min(i + INSERT_BATCH_SIZE, chunks.length);
      console.log(`  ${progress}/${chunks.length} rows processed`);
    }

    console.log(`\n--- Summary ---`);
    console.log(`Inserted: ${inserted}`);
    console.log(`Updated:  ${updated}`);
    console.log(`Total:    ${inserted + updated}`);

    // Verify with a count
    const countResult = await client.query("SELECT COUNT(*) FROM chunks");
    console.log(`Rows in DB: ${countResult.rows[0].count}`);
  } finally {
    await client.end();
  }
}

/**
 * Embed all chunks by batching calls to the shared embedText utility.
 * Returns array of embeddings in the same order as input chunks.
 */
async function embedAllChunks(chunks: DocChunk[]): Promise<number[][]> {
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batch.map((c) => c.content);

    const batchEmbeddings = await embedText(texts);
    allEmbeddings.push(...batchEmbeddings);

    const progress = Math.min(i + EMBED_BATCH_SIZE, chunks.length);
    console.log(`  Embedded ${progress}/${chunks.length}`);
  }

  return allEmbeddings;
}

/**
 * Insert a batch of chunks + embeddings into Postgres.
 * Uses upsert (ON CONFLICT DO UPDATE) so re-runs update existing rows.
 */
async function insertBatch(
  client: pg.Client,
  chunks: DocChunk[],
  embeddings: number[][]
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  // Wrap the batch in a transaction for atomicity
  await client.query("BEGIN");

  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];

      // pgvector expects the embedding as a string like '[0.1, 0.2, ...]'
      const embeddingStr = `[${embedding.join(",")}]`;

      const result = await client.query(
        `INSERT INTO chunks (id, tenant_id, source_file, doc_title, section_path, content, doc_type, embedding, search_vector)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_tsvector('english', $4 || ' ' || $6))
         ON CONFLICT (id) DO UPDATE SET
           content = EXCLUDED.content,
           section_path = EXCLUDED.section_path,
           doc_title = EXCLUDED.doc_title,
           embedding = EXCLUDED.embedding,
           search_vector = to_tsvector('english', EXCLUDED.doc_title || ' ' || EXCLUDED.content)
         RETURNING (xmax = 0) AS is_insert`,
        [
          chunk.id,
          chunk.tenant_id,
          chunk.source_file,
          chunk.doc_title,
          chunk.section_path,
          chunk.content,
          chunk.doc_type,
          embeddingStr,
        ]
      );

      // xmax = 0 means the row was inserted (not updated)
      if (result.rows[0].is_insert) {
        inserted++;
      } else {
        updated++;
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }

  return { inserted, updated };
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
