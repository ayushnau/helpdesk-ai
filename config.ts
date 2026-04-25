import type { Provider } from "./providers/index.js";
import { createOpenAICompatProvider } from "./providers/index.js";
import dotenv from "dotenv";
dotenv.config();

// ── Provider selection ─────────────────────────────────────────────────────
//
// All these providers speak the SAME "OpenAI-compatible" API format.
// Only 3 things change between them: URL, API key, model name.
//
//   npx tsx main.ts                   → ollama / qwen2.5:7b  (local)
//   npx tsx main.ts ollama mistral    → ollama / mistral     (local)
//   npx tsx main.ts gemini            → gemini-2.0-flash     (cloud)
//   npx tsx main.ts groq              → llama-3.3-70b        (cloud)

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Set ${name} env var first`);
  return val;
}

export function pickProvider(): Provider {
  const [, , backend, model] = process.argv;

  switch (backend) {
    case "gemini":
      return createOpenAICompatProvider({
        name: `gemini/${model || "gemini-2.0-flash"}`,
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: model || "gemini-2.0-flash",
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
        baseUrl: "http://localhost:11434/v1",
        model: model || "qwen2.5:7b",
      });
  }
}

// Singleton: resolved once at module load so the agent loop and the REPL
// share the exact same provider instance instead of constructing two.
export const provider = pickProvider();

