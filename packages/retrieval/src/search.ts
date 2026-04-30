import { retrieveChunks } from "./retrieve.js";

const query = process.argv[2];
if (!query) {
  console.error("Usage: bun run packages/retrieval/src/search.ts \"your query here\"");
  process.exit(1);
}

const tenantId = process.argv[3] || "posthog";
const topK = Number(process.argv[4]) || 5;

console.log(`Query: "${query}"`);
console.log(`Tenant: ${tenantId} | Top-K: ${topK}\n`);

const chunks = await retrieveChunks(query, tenantId, topK);

for (const chunk of chunks) {
  console.log(`--- [${chunk.similarity.toFixed(4)}] ${chunk.section_path} ---`);
  console.log(chunk.content.slice(0, 200));
  console.log();
}
