const OLLAMA_URL = "http://localhost:11434/api/embed";
const OLLAMA_MODEL = "nomic-embed-text";

/**
 * Embed one or more texts using Ollama.
 * Returns one embedding (number[]) per input string.
 */
export async function embedText(input: string | string[]): Promise<number[][]> {
  const texts = Array.isArray(input) ? input : [input];

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
