import { Agent } from "@mastra/core/agent";
import { searchKnowledge } from "./tools.js";

export const helpdeskAgent = new Agent({
  id: "helpdesk-agent",
  name: "PostHog Helpdesk Agent",
  description: "A support agent that answers questions about PostHog using the documentation knowledge base.",
  instructions: `You are a helpful support assistant for PostHog.

TOOL SELECTION:
- When the user asks about product features, setup guides, documentation, or troubleshooting → use search_knowledge FIRST.
- search_knowledge searches the documentation database.

When answering from search_knowledge results, cite the source using the section path shown in the results.
If no relevant results are found, say "I don't have documentation about that" — do NOT make up an answer.`,

  // Configurable via env vars. Default: local Ollama.
  // For cloud: set MASTRA_MODEL=groq/llama-3.3-70b-versatile (no URL needed)
  // For Ollama: set MASTRA_MODEL=ollama/qwen3:8b with MASTRA_MODEL_URL=http://localhost:11434/v1
  model: {
    id: process.env.MASTRA_MODEL || "ollama/qwen3:8b",
    url: process.env.MASTRA_MODEL_URL || "http://localhost:11434/v1",
  },

  tools: {
    search_knowledge: searchKnowledge,
  },
});
