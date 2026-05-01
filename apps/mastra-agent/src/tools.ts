import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { retrieveChunks } from "@helpdesk-ai/retrieval";

export const searchKnowledge = createTool({
  id: "search_knowledge",
  description:
    "Search the knowledge base for relevant documentation. Use this when the user asks about product features, setup guides, or troubleshooting.",
  inputSchema: z.object({
    query: z.string().min(1).describe("Search query — rephrase the user's question into keywords"),
    tenant_id: z.string().optional().describe("Tenant ID (defaults to 'posthog')"),
  }),
  outputSchema: z.string(),
  async execute(input) {
    const tenantId = input.tenant_id || "posthog";
    const chunks = await retrieveChunks(input.query, tenantId);

    if (chunks.length === 0) {
      return "No relevant documentation found for this query.";
    }

    return chunks
      .map(
        (chunk, i) =>
          `[${i + 1}] (score: ${chunk.similarity.toFixed(4)}) ${chunk.section_path}\n${chunk.content}`
      )
      .join("\n\n---\n\n");
  },
});
