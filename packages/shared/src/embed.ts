import dotenv from "dotenv";
dotenv.config();

const OLLAMA_URL = process.env.OLLAMA_HOST
  ? `${process.env.OLLAMA_HOST.replace(/\/v1\/?$/, "")}/api/embed`
  : "http://localhost:11434/api/embed";
const OLLAMA_MODEL = "nomic-embed-text";

const GEMINI_EMBED_MODEL = "text-embedding-004";

// Pick embedding backend based on LLM_PROVIDER env or CLI arg
function useGemini(): boolean {
  const [, , cliLlm] = process.argv;
  const provider = cliLlm || process.env.LLM_PROVIDER || "ollama";
  return provider === "gemini";
}

/**
 * Embed one or more texts.
 * Automatically uses Gemini or Ollama based on the active LLM provider.
 */
export async function embedText(input: string | string[]): Promise<number[][]> {
  const texts = Array.isArray(input) ? input : [input];

  if (useGemini()) {
    return embedWithGemini(texts);
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

async function embedWithGemini(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY env var required for Gemini embeddings");

  // Gemini embedding API supports batch via batchEmbedContents
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
