import dotenv from "dotenv";
dotenv.config();

import type { Provider } from "./providers/index.js";
import { createOpenAICompatProvider } from "./providers/index.js";

export function pickProvider(): Provider {
  // Support both CLI args (local dev) and env vars (deployment)
  const [, , cliLlm, cliModel] = process.argv;
  const llm = cliLlm || process.env.LLM_PROVIDER || "ollama";
  const model = cliModel || process.env.LLM_MODEL || undefined;

  switch (llm) {
    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        // No server-side key — create a placeholder provider that errors on use.
        // Users must provide their own key via the Settings UI (X-Gemini-Key header).
        console.warn("[config] No GEMINI_API_KEY set. Server will rely on client-provided keys.");
        return createOpenAICompatProvider({
          name: "gemini/gemini-2.5-flash-lite (no server key)",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
          model: model || "gemini-2.5-flash-lite",
          apiKey: "placeholder-requires-client-key",
        });
      }
      return createOpenAICompatProvider({
        name: `gemini/${model || "gemini-2.5-flash-lite"}`,
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: model || "gemini-2.5-flash-lite",
        apiKey,
      });
    }

    case "groq": {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        console.warn("[config] No GROQ_API_KEY set. Server will rely on client-provided keys.");
        return createOpenAICompatProvider({
          name: "groq/llama-3.3-70b-versatile (no server key)",
          baseUrl: "https://api.groq.com/openai/v1",
          model: model || "llama-3.3-70b-versatile",
          apiKey: "placeholder-requires-client-key",
        });
      }
      return createOpenAICompatProvider({
        name: `groq/${model || "llama-3.3-70b-versatile"}`,
        baseUrl: "https://api.groq.com/openai/v1",
        model: model || "llama-3.3-70b-versatile",
        apiKey,
      });
    }

    case "ollama":
    default:
      return createOpenAICompatProvider({
        name: `ollama/${model || "qwen2.5:7b"}`,
        baseUrl: process.env.OLLAMA_HOST || "http://localhost:11434/v1",
        model: model || "qwen2.5:7b",
      });
  }
}

// Singleton: resolved once at module load so the agent loop and the REPL
// share the exact same provider instance instead of constructing two.
export const provider = pickProvider();

/**
 * Create a provider from a client-supplied API key.
 * Used when a demo user provides their own key via the UI.
 * Falls back to the singleton provider if no key is provided.
 */
export function providerFromClientKey(opts: { geminiKey?: string; groqKey?: string }): Provider | null {
  if (opts.geminiKey) {
    return createOpenAICompatProvider({
      name: "gemini/gemini-2.5-flash-lite",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-2.5-flash-lite",
      apiKey: opts.geminiKey,
    });
  }
  if (opts.groqKey) {
    return createOpenAICompatProvider({
      name: "groq/llama-3.3-70b-versatile",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "llama-3.3-70b-versatile",
      apiKey: opts.groqKey,
    });
  }
  return null;
}
