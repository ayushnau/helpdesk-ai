import dotenv from "dotenv";
dotenv.config();

import type { Provider } from "./providers/index.js";
import { createOpenAICompatProvider } from "./providers/index.js";


function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Set ${name} env var first`);
  return val;
}

export function pickProvider(): Provider {
  // Support both CLI args (local dev) and env vars (deployment)
  const [, , cliLlm, cliModel] = process.argv;
  const llm = cliLlm || process.env.LLM_PROVIDER || "ollama";
  const model = cliModel || process.env.LLM_MODEL || undefined;

  switch (llm) {
    case "gemini":
      return createOpenAICompatProvider({
        name: `gemini/${model || "gemini-2.5-flash-lite"}`,
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: model || "gemini-2.5-flash-lite",
        apiKey: requireEnv("GEMINI_API_KEY"),
      });

    case "groq":
      return createOpenAICompatProvider({
        name: `groq/${model || "llama-3.3-70b-versatile"}`,
        baseUrl: "https://api.groq.com/openai/v1",
        model: model || "llama-3.3-70b-versatile",
        apiKey: requireEnv("GROQ_API_KEY"),
      });

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
