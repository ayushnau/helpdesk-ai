import type { Provider, ProviderResponse, Message, ToolDef, ToolCall } from "./types.js";

// ── OpenAI-compatible provider ──────────────────────────────────────────────
//
// WHY ONE FILE INSTEAD OF MANY?
//
// Ollama, Gemini, OpenAI, Groq, Together, LMStudio — they all speak the
// same REST API format: POST /v1/chat/completions with the same JSON shape.
// This is called the "OpenAI-compatible" format and it's become a standard.
//
// The only things that differ between providers:
//   1. The base URL
//   2. Whether they need an API key (and how to send it)
//   3. The model name
//
// So instead of duplicating 100 lines per provider, we write ONE function
// that takes { url, apiKey, model } and works for all of them.

export interface OpenAICompatConfig {
  name: string;     // display name like "ollama/qwen2.5:7b"
  baseUrl: string;  // e.g. "http://localhost:11434/v1"
  model: string;    // e.g. "qwen2.5:7b"
  apiKey?: string;  // optional — Ollama doesn't need one, Gemini does
}

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

    // ── Call the API ─────────────────────────────────────────────────────

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`${config.name} error ${res.status}: ${await res.text()}`);
    }

    // ── Parse response ──────────────────────────────────────────────────
    //
    // Response shape (same for ALL OpenAI-compatible APIs):
    // {
    //   choices: [{
    //     message: { content: "...", tool_calls: [...] },
    //     finish_reason: "stop" | "tool_calls" | "length"
    //   }]
    // }

    const json = await res.json() as any;
    const choice = json.choices?.[0];
    if (!choice) throw new Error(`No response from ${config.name}`);

    const msg = choice.message;

    const toolCalls: ToolCall[] = (msg.tool_calls || []).map((tc: any) => {
      let args: Record<string, unknown> = {};
      try {
        args = typeof tc.function.arguments === "string"
          ? JSON.parse(tc.function.arguments)
          : tc.function.arguments;
      } catch {
        args = { _raw: tc.function.arguments };
      }
      return { id: tc.id, name: tc.function.name, arguments: args };
    });

    let finishReason: ProviderResponse["finishReason"] = "stop";
    if (choice.finish_reason === "tool_calls" || toolCalls.length > 0) {
      finishReason = "tool_calls";
    } else if (choice.finish_reason === "length") {
      finishReason = "length";
    }

    return { text: msg.content || "", toolCalls, finishReason };
  }

  return { name: config.name, chat };
}

// ── Format a single message to OpenAI shape ─────────────────────────────────

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
