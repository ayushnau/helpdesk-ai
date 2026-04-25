import type { Provider, ProviderResponse, ProviderError, ProviderErrorType, Message, ToolDef, ToolCall, TokenUsage } from "./types.js";


export interface OpenAICompatConfig {
  name: string;     // display name like "ollama/qwen2.5:7b"
  baseUrl: string;  // e.g. "http://localhost:11434/v1"
  model: string;    // e.g. "qwen2.5:7b"
  apiKey?: string;  // optional — Ollama doesn't need one, Gemini does
}

// ── Retry policy ────────────────────────────────────────────────────────────
//
// Transient failures (rate limits, overloaded upstreams, flaky networks) are
// the #1 reason production agents die. A single un-retried 429 takes down
// the whole conversation. We retry with FULL JITTER exponential backoff
// because synchronized retries from multiple clients create thundering
// herds — jitter spreads them out.
//
// What we retry:
//   429 Too Many Requests  — rate limited, the API is explicitly asking us to wait
//   500/502/503/504        — upstream is unhealthy, probably transient
//   network errors         — DNS, TCP reset, TLS handshake, etc.
//
// What we DON'T retry:
//   400 Bad Request        — our request is malformed, retrying won't fix it
//   401/403                — auth problem, retrying will fail the same way
//   404                    — wrong URL/model, retrying is pointless
//   422                    — semantic error in request body
//   context_length_exceeded — retrying burns the same tokens; caller must trim
//
// We honor Retry-After when the server tells us how long to wait (429s and
// some 503s include it). Otherwise we fall back to jittered backoff.

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;
const RETRIABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export function createOpenAICompatProvider(config: OpenAICompatConfig): Provider {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;

  async function chat(messages: Message[], tools: ToolDef[]): Promise<ProviderResponse> {

    // ── Build request body ──────────────────────────────────────────────
    // Convert our types → OpenAI format. Every compatible API expects this.

    const body: Record<string, unknown> = {
      model: config.model,
      stream: false,
      messages: messages.map(formatMessage),
    };

    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    // ── Call the API (with retries) ─────────────────────────────────────

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    // ── Call the API ───────────────────────────────────────────────────
    //
    // Two failure modes:
    //   1. Network-level (DNS, TCP, TLS) — fetchWithRetry throws after
    //      exhausting retries. We catch it below.
    //   2. HTTP-level (4xx/5xx) — fetchWithRetry returns the response
    //      after exhausting retries for retriable codes, or immediately
    //      for non-retriable codes. We classify and return structured.

    let res: Response;
    try {
      res = await fetchWithRetry(
        url,
        { method: "POST", headers, body: JSON.stringify(body) },
        config.name,
      );
    } catch (err) {
      // Network failure after all retries exhausted.
      return errorResponse("network", err instanceof Error ? err.message : String(err));
    }

    if (!res.ok) {
      const body = await res.text();
      return errorResponse(
        classifyHttpError(res.status, body),
        `${config.name} HTTP ${res.status}: ${body}`,
        res.status,
      );
    }

    // ── Parse response ──────────────────────────────────────────────────
    //
    // Response shape (same for ALL OpenAI-compatible APIs):
    // {
    //   choices: [{
    //     message: { content: "...", tool_calls: [...] },
    //     finish_reason: "stop" | "tool_calls" | "length"
    //   }],
    //   usage: { prompt_tokens, completion_tokens, total_tokens }
    // }

    const json = await res.json() as any;
    const choice = json.choices?.[0];
    if (!choice) {
      return errorResponse("unknown", `No choices in response from ${config.name}`);
    }

    const msg = choice.message;

    const toolCalls: ToolCall[] = (msg.tool_calls || []).map((tc: any) => {
      let args: Record<string, unknown> = {};
      try {
        args = typeof tc.function.arguments === "string"
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments;
      } catch {
        // Model emitted malformed JSON in the tool-call args. We stash
        // the raw string so the tool layer can surface a validation
        // error instead of crashing on JSON.parse.
        args = { _raw: tc.function.arguments };
      }
      return { id: tc.id, name: tc.function.name, arguments: args };
    });

    let status: ProviderResponse["status"] = "stop";
    if (choice.finish_reason === "tool_calls" || toolCalls.length > 0) {
      status = "tool_calls";
    } else if (choice.finish_reason === "length") {
      status = "length";
    }

    // Normalize usage to camelCase. Providers may omit it entirely
    // (some Ollama builds, streaming responses); we return null then.
    const usage: TokenUsage | null = json.usage
      ? {
          promptTokens: json.usage.prompt_tokens ?? 0,
          completionTokens: json.usage.completion_tokens ?? 0,
          totalTokens: json.usage.total_tokens ?? 0,
        }
      : null;

    return { text: msg.content || "", toolCalls, status, usage };
  }

  return { name: config.name, chat };
}


function formatMessage(m: Message) {
  // Assistant message that includes tool calls
  if (m.role === "assistant" && m.tool_calls?.length) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    };
  }
  // Tool result — needs the tool_call_id so the LLM knows which call it answers
  if (m.role === "tool") {
    return { role: "tool", content: m.content, tool_call_id: m.tool_call_id };
  }
  // System, user, or plain assistant
  return { role: m.role, content: m.content };
}

// ── Retry helpers ───────────────────────────────────────────────────────────

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  providerName: string,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, init);

      // Not an error, or a non-retriable error → return to caller as-is.
      if (res.ok || !RETRIABLE_STATUS.has(res.status)) {
        return res;
      }

      // Retriable status. Last attempt? Let the caller see the final response.
      if (attempt === MAX_ATTEMPTS - 1) return res;

      // Server hinted how long to wait — honor it. Otherwise full jitter.
      const hinted = parseRetryAfter(res.headers.get("retry-after"));
      const delay = hinted ?? jitteredBackoff(attempt);
      console.log(
        `\x1b[33m[retry] ${providerName} HTTP ${res.status} — waiting ${delay}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})\x1b[0m`,
      );
      await sleep(delay);
    } catch (err) {
      // Network-level failure (DNS, ECONNRESET, TLS, timeout). Treat as retriable.
      lastError = err;
      if (attempt === MAX_ATTEMPTS - 1) throw err;

      const delay = jitteredBackoff(attempt);
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `\x1b[33m[retry] ${providerName} network error: ${msg} — waiting ${delay}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})\x1b[0m`,
      );
      await sleep(delay);
    }
  }

  // Should be unreachable — every path above either returns or throws.
  throw lastError ?? new Error(`${providerName}: retry loop exhausted`);
}

// Full jitter: sleep = random(0, min(cap, base * 2^attempt)).
// Full jitter beats equal / decorrelated jitter for avoiding thundering
// herds when many clients retry together. See AWS Architecture Blog:
// "Exponential Backoff And Jitter".
function jitteredBackoff(attempt: number): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

// Retry-After can be either a number of seconds ("5") or an HTTP-date
// ("Wed, 21 Oct 2015 07:28:00 GMT"). Parse both, return ms or null.
function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const epoch = Date.parse(header);
  if (Number.isFinite(epoch)) return Math.max(0, epoch - Date.now());
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Error classification ───────────────────────────────────────────────────

// Build a ProviderResponse with status "error". Keeps the happy path clean.
function errorResponse(
  type: ProviderErrorType,
  message: string,
  statusCode?: number,
): ProviderResponse {
  return {
    text: "",
    toolCalls: [],
    status: "error",
    usage: null,
    error: { type, message, statusCode },
  };
}

// Map HTTP status + body to a typed error category.
//
// Most OpenAI-compatible APIs return structured error JSON:
//   { "error": { "message": "...", "type": "...", "code": "..." } }
//
// error.code is machine-readable and the most reliable signal. We check
// it first, then fall back to regex on the raw body for providers that
// don't follow the convention.
function classifyHttpError(status: number, body: string): ProviderErrorType {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";

  if (status === 400 || status === 422) {
    // Try structured error first — parse once, check the code field.
    try {
      const json = JSON.parse(body);
      const code = json?.error?.code ?? "";
      if (code === "context_length_exceeded" || code === "model_max_length") {
        return "context_length_exceeded";
      }
    } catch(err) {
      console.error(err, "handling though the fallback")
    }

    if (/context.length|max.tokens|too.long|token.limit/i.test(body)) {
      return "context_length_exceeded";
    }
    return "bad_request";
  }

  return "unknown";
}
