import type { Provider, ProviderResponse, ProviderError, ProviderErrorType, Message, ToolDef, ToolCall, TokenUsage, StreamEvent } from "./types.js";


export interface OpenAICompatConfig {
  name: string;     // display name like "ollama/qwen2.5:7b"
  baseUrl: string;  // e.g. "http://localhost:11434/v1"
  model: string;    // e.g. "qwen2.5:7b"
  apiKey?: string;  // optional — Ollama doesn't need one, Gemini does
}

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


  async function* chatStream(messages: Message[], tools: ToolDef[]): AsyncGenerator<StreamEvent> {
    const body: Record<string, unknown> = {
      model: config.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: messages.map(formatMessage),
    };

    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    let res: Response;
    try {
      res = await fetchWithRetry(url, { method: "POST", headers, body: JSON.stringify(body) }, config.name);
    } catch (err) {
      yield { type: "error", error: { type: "network", message: err instanceof Error ? err.message : String(err) } };
      return;
    }

    if (!res.ok) {
      const text = await res.text();
      yield { type: "error", error: { type: classifyHttpError(res.status, text), message: `${config.name} HTTP ${res.status}: ${text}`, statusCode: res.status } };
      return;
    }

    if (!res.body) {
      yield { type: "error", error: { type: "unknown", message: "Response body is null — streaming not supported by this provider" } };
      return;
    }

    const partials = new Map<number, { id: string; name: string; arguments: string }>();
    let usage: TokenUsage | null = null;
    let finishReason: ProviderResponse["status"] = "stop";

    try {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";  // SSE lines can be split across chunks

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          const payload = line.slice(6);  // strip "data: " prefix

          if (payload === "[DONE]") continue;

          let chunk: any;
          try {
            chunk = JSON.parse(payload);
          } catch {
            continue;
          }

          if (chunk.usage) {
            usage = {
              promptTokens: chunk.usage.prompt_tokens ?? 0,
              completionTokens: chunk.usage.completion_tokens ?? 0,
              totalTokens: chunk.usage.total_tokens ?? 0,
            };
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          if (choice.finish_reason) {
            if (choice.finish_reason === "tool_calls" || partials.size > 0) {
              finishReason = "tool_calls";
            } else if (choice.finish_reason === "length") {
              finishReason = "length";
            } else {
              finishReason = "stop";
            }
          }

          const delta = choice.delta;
          if (!delta) continue;

          if (delta.content) {
            yield { type: "text", token: delta.content };
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!partials.has(idx)) {
                partials.set(idx, {
                  id: tc.id || "",
                  name: tc.function?.name || "",
                  arguments: "",
                });
              }
              const partial = partials.get(idx)!;
              if (tc.id) partial.id = tc.id;
              if (tc.function?.name) partial.name = tc.function.name;
              if (tc.function?.arguments) partial.arguments += tc.function.arguments;
            }
          }
        }
      }
    } catch (err) {
      yield { type: "error", error: { type: "network", message: `Stream interrupted: ${err instanceof Error ? err.message : String(err)}` } };
      return;
    }

    for (const [, partial] of partials) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(partial.arguments);
      } catch {
        args = { _raw: partial.arguments };
      }
      yield { type: "tool_call", toolCall: { id: partial.id, name: partial.name, arguments: args } };
    }

    yield { type: "done", usage, finishReason };
  }

  return { name: config.name, chat, chatStream };
}


function formatMessage(m: Message) {
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
  if (m.role === "tool") {
    return { role: "tool", content: m.content, tool_call_id: m.tool_call_id };
  }
  return { role: m.role, content: m.content };
}


async function fetchWithRetry(
  url: string,
  init: RequestInit,
  providerName: string,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, init);

      if (res.ok || !RETRIABLE_STATUS.has(res.status)) {
        return res;
      }

      if (attempt === MAX_ATTEMPTS - 1) return res;

      const hinted = parseRetryAfter(res.headers.get("retry-after"));
      const delay = hinted ?? jitteredBackoff(attempt);
      console.log(
        `\x1b[33m[retry] ${providerName} HTTP ${res.status} — waiting ${delay}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})\x1b[0m`,
      );
      await sleep(delay);
    } catch (err) {
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

  throw lastError ?? new Error(`${providerName}: retry loop exhausted`);
}

function jitteredBackoff(attempt: number): number {
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}

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

function classifyHttpError(status: number, body: string): ProviderErrorType {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";

  if (status === 400 || status === 422) {
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
