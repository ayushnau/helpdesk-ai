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

// What we get back from the LLM after one API call
export interface ProviderResponse {
  text: string;           // what the LLM said (may be empty if it only called tools)
  toolCalls: ToolCall[];  // tools it wants us to run (empty if none)
  status: "stop" | "tool_calls" | "length";
  usage: TokenUsage | null;
}

// The one method every provider must implement
export interface Provider {
  name: string;
  chat(messages: Message[], tools: ToolDef[]): Promise<ProviderResponse>;
}
