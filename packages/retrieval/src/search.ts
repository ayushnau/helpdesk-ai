import { retrieveChunks } from "./retrieve.js";

const query = process.argv[2];
if (!query) {
  console.error('Usage: bun run search "your query" [tenantId] [topK] [vectorWeight] [textWeight]');
  process.exit(1);
}

// bun run search "<query>" [tenantId] [topK] [vectorWeight] [textWeight]   
       
const tenantId = process.argv[3] || "posthog";
const topK = Number(process.argv[4]) || 5;
const vectorWeight = process.argv[5] !== undefined ? Number(process.argv[5]) : 0.5;
const textWeight = process.argv[6] !== undefined ? Number(process.argv[6]) : 0.5;

console.log(`Query: "${query}"`);
console.log(`Tenant: ${tenantId} | Top-K: ${topK} | Weights: vector=${vectorWeight}, text=${textWeight}\n`);

const chunks = await retrieveChunks(query, tenantId, { topK, vectorWeight, textWeight });

for (const chunk of chunks) {
  console.log(`--- [${chunk.similarity.toFixed(4)}] ${chunk.section_path} ---`);
  console.log(chunk.content.slice(0, 200));
  console.log();
}
