import dotenv from "dotenv";
dotenv.config();

const OLLAMA_URL = process.env.OLLAMA_HOST
  ? `${process.env.OLLAMA_HOST.replace(/\/v1\/?$/, "")}/api/embed`
  : "http://localhost:11434/api/embed";
const OLLAMA_MODEL = "nomic-embed-text";

const GEMINI_EMBED_MODEL = "gemini-embedding-001";

// Pick embedding backend based on LLM_PROVIDER env or CLI arg
function useGemini(): boolean {
  const [, , cliLlm] = process.argv;
  const provider = cliLlm || process.env.LLM_PROVIDER || "ollama";
  return provider === "gemini";
}

/**
 * Embed one or more texts.
 * Automatically uses Gemini or Ollama based on the active LLM provider.
 *
 * @param apiKey — optional Gemini API key override (for tenant's stored key).
 *                 Falls back to GEMINI_API_KEY env var if not provided.
 */
export async function embedText(input: string | string[], apiKey?: string): Promise<number[][]> {
  const texts = Array.isArray(input) ? input : [input];

  if (useGemini() || apiKey) {
    return embedWithGemini(texts, apiKey);
  }
  return embedWithOllama(texts);
}

async function embedWithOllama(texts: string[]): Promise<number[][]> {
  const response = await fetch(OLLAMA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, input: texts }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Ollama embed failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { embeddings: number[][] };

  if (data.embeddings.length !== texts.length) {
    throw new Error(
      `Ollama returned ${data.embeddings.length} embeddings for ${texts.length} inputs`
    );
  }

  return data.embeddings;
}

async function embedWithGemini(texts: string[], keyOverride?: string): Promise<number[][]> {
  const apiKey = keyOverride || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini API key required for embeddings. Set GEMINI_API_KEY env var or provide via Settings.");

  const requests = texts.map((text) => ({
    model: `models/${GEMINI_EMBED_MODEL}`,
    content: { parts: [{ text }] },
  }));

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:batchEmbedContents?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini embed failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    embeddings: { values: number[] }[];
  };

  if (data.embeddings.length !== texts.length) {
    throw new Error(
      `Gemini returned ${data.embeddings.length} embeddings for ${texts.length} inputs`
    );
  }

  return data.embeddings.map((e) => e.values);
}
