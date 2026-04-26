// ── What is a "Provider"? ───────────────────────────────────────────────────
//
// A provider is any LLM backend (Ollama, Gemini, OpenAI, etc.)
// We define a common shape so the agent doesn't care which one it's talking to.
//
// Think of it like a universal remote — different TVs, same buttons.

// A tool is a function the LLM can ask us to run.
// We describe it with a name, what it does, and what inputs it needs.
export interface ToolDef {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// A message in the conversation. Same shape as OpenAI/Ollama format.
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];   // assistant says "please run these tools"
  tool_call_id?: string;     // our response: "here's the result for that tool call"
}

// When the LLM wants to call a tool, it gives us this:
export interface ToolCall {
  id: string;                          // unique id to match result back
  name: string;                        // which tool to run
  arguments: Record<string, unknown>;  // the inputs
}

// Per-call token counts, as reported by the provider.
// null when the provider doesn't expose usage (some Ollama builds don't).
// Every serious agent logs this: it's how you spot a runaway loop or a
// context bloat bug before it burns $500 in evals.
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}


export type ProviderErrorType =
  | "auth"                      // 401/403 — wrong or expired API key
  | "bad_request"               // 400/422 — malformed request body
  | "context_length_exceeded"   // special case of 400 — history too long
  | "rate_limited"              // 429 — exhausted retries
  | "server_error"              // 5xx — exhausted retries
  | "network"                   // DNS, ECONNRESET, TLS, timeout
  | "unknown";

export interface ProviderError {
  type: ProviderErrorType;
  message: string;
  statusCode?: number;          // HTTP status when available
}

// What we get back from the LLM after one API call
export interface ProviderResponse {
  text: string;           // what the LLM said (may be empty if it only called tools)
  toolCalls: ToolCall[];  // tools it wants us to run (empty if none)
  status: "stop" | "tool_calls" | "length" | "error";
  usage: TokenUsage | null;
  error?: ProviderError;  // populated only when status === "error"
}

export type StreamEvent =
  | { type: "text";      token: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "done";      usage: TokenUsage | null; finishReason: ProviderResponse["status"] }
  | { type: "error";     error: ProviderError };

export interface Provider {
  name: string;
  chat(messages: Message[], tools: ToolDef[]): Promise<ProviderResponse>;
  chatStream?(messages: Message[], tools: ToolDef[]): AsyncGenerator<StreamEvent>;
}
