import type { Message, TokenUsage, ToolCall, ProviderResponse, ProviderError, Provider } from "./providers/index.js";
import { provider as defaultProvider } from "./config.js";
import { tools, executeTool, setActiveTenantId, type ToolResult } from "./tools.js";
import { isShuttingDown } from "./shutdown.js";
import { compressIfNeeded } from "./memory.js";
import type { ConversationContext } from "./tenant.js";
import { createConversationContext } from "./tenant.js";

// ── Default context for REPL (backward compat) ─────────────────────────────
//
// The REPL doesn't know about tenants or sessions. It uses this default
// context so the existing CLI keeps working unchanged.

const DEFAULT_SYSTEM_PROMPT = `You are a helpful support assistant for PostHog. You MUST use the provided tools to answer questions. NEVER describe what you would do — actually do it by calling the tools. Do NOT write code snippets. Call the tool directly.

TOOL SELECTION:
- When the user asks about product features, setup guides, documentation, or troubleshooting → use search_knowledge FIRST.
- Only use search_text for searching local code files on disk.
- search_knowledge searches the documentation database. search_text greps local files. They are different tools for different purposes.

When answering from search_knowledge results, cite the source using the section path shown in the results. If no relevant results are found, say "I don't have documentation about that" — do NOT make up an answer.

Current working directory: ${process.cwd()}
If you don't know a file path, call list_directory first to discover it. NEVER guess paths.

Tool results are structured JSON of the form:
  {"ok": true, "data": "..."}
  {"ok": false, "error": {"type": "...", "message": "..."}}
When ok is false, read the error type and message, correct your inputs, and retry — do not give up on the first failure.`;

const defaultContext = createConversationContext("repl", {
  tenantId: "posthog",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  maxTokensPerDay: 0,
});

// ── Public API for REPL (backward compat) ───────────────────────────────────
// These expose the default context's state so the REPL code doesn't change.

export const messages = defaultContext.messages;

export function clearConversation(): void {
  defaultContext.messages.length = 1;
  defaultContext.memoryState.summary = null;
  defaultContext.tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

// ── Token accounting ────────────────────────────────────────────────────────

function accumulate(target: TokenUsage, add: TokenUsage): void {
  target.promptTokens += add.promptTokens;
  target.completionTokens += add.completionTokens;
  target.totalTokens += add.totalTokens;
}

// Context window size for the model — used to decide when to compress.
const MAX_CONTEXT_TOKENS = parseInt(process.env.MAX_CONTEXT_TOKENS || "8192", 10);

// ── Agent turn result ───────────────────────────────────────────────────────
// For HTTP mode, callers need the agent's response text + token usage.
// REPL mode prints directly to stdout so it doesn't need this.

export interface AgentTurnResult {
  text: string;
  turnTokens: TokenUsage;
}

// ── The agent loop ──────────────────────────────────────────────────────────
//
// Now accepts an optional ConversationContext. If not provided, uses the
// module-level default (REPL mode). This is how multi-tenancy works:
// each HTTP request creates its own context and passes it in.

// agentTurn is now a thin wrapper over agentTurnStream — single source of truth.
// Collects all streamed events into a final result, with REPL-style console output.
export async function agentTurn(
  ctx: ConversationContext = defaultContext,
  activeProvider: Provider = defaultProvider,
): Promise<AgentTurnResult> {
  let result: AgentTurnResult = { text: "", turnTokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
  let firstText = true;

  for await (const event of agentTurnStream(ctx, activeProvider)) {
    switch (event.type) {
      case "text":
        if (firstText) {
          process.stdout.write(`\n\x1b[36massistant:\x1b[0m `);
          firstText = false;
        }
        process.stdout.write(event.token);
        break;
      case "tool_start":
        console.log(`\n\x1b[33m  [tool] ${event.name}(\x1b[0m${JSON.stringify(event.args)}\x1b[33m)\x1b[0m`);
        break;
      case "tool_end": {
        const color = event.ok ? "\x1b[90m" : "\x1b[31m";
        console.log(`${color}  → [${event.name}] ${event.result}\x1b[0m`);
        break;
      }
      case "error":
        console.log(`\n\x1b[31m[agent] ${event.message}\x1b[0m`);
        break;
      case "done":
        if (!firstText) process.stdout.write("\n");
        result = { text: event.text, turnTokens: event.turnTokens };
        logTurnSummary(event.turnTokens, ctx.tokenUsage);
        break;
    }
  }

  return result;
}


// ── Streaming agent turn ────────────────────────────────────────────────────
// Yields events as they happen instead of returning a final result.
// Used by the SSE endpoint to stream responses to the browser.

export type AgentStreamEvent =
  | { type: "text"; token: string }
  | { type: "tool_start"; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; name: string; result: string; ok: boolean }
  | { type: "done"; text: string; turnTokens: TokenUsage }
  | { type: "error"; message: string };

export async function* agentTurnStream(
  ctx: ConversationContext = defaultContext,
  activeProvider: Provider = defaultProvider,
): AsyncGenerator<AgentStreamEvent> {
  // Set the active tenant so search_knowledge scopes to the right tenant's docs
  setActiveTenantId(ctx.tenantConfig.tenantId);

  const MAX_ITERATIONS = 10;
  const MAX_CONTINUATIONS = parseInt(process.env.MAX_CONTINUATIONS || "3", 10);

  let continuations = 0;
  let fullResponseText = "";
  const turnTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (isShuttingDown()) {
      yield { type: "done", text: fullResponseText, turnTokens };
      return;
    }

    await compressIfNeeded(ctx.messages, ctx.memoryState, activeProvider, MAX_CONTEXT_TOKENS);

    let text = "";
    let responseToolCalls: ToolCall[] = [];
    let status: ProviderResponse["status"] = "stop";
    let responseUsage: TokenUsage | null = null;
    let responseError: ProviderError | undefined;

    if (activeProvider.chatStream) {
      for await (const event of activeProvider.chatStream(ctx.messages, tools)) {
        switch (event.type) {
          case "text":
            text += event.token;
            yield { type: "text", token: event.token };
            break;
          case "tool_call":
            responseToolCalls.push(event.toolCall);
            break;
          case "done":
            responseUsage = event.usage;
            status = event.finishReason;
            break;
          case "error":
            responseError = event.error;
            status = "error";
            break;
        }
      }
    } else {
      const response = await activeProvider.chat(ctx.messages, tools);
      text = response.text;
      responseToolCalls = response.toolCalls;
      status = response.status;
      responseUsage = response.usage;
      responseError = response.error;
      if (text) yield { type: "text", token: text };
    }

    if (responseUsage) {
      accumulate(turnTokens, responseUsage);
      accumulate(ctx.tokenUsage, responseUsage);
    }

    fullResponseText += text;

    const assistantMsg: Message = { role: "assistant", content: text };
    if (responseToolCalls.length > 0) {
      assistantMsg.tool_calls = responseToolCalls;
    }
    ctx.messages.push(assistantMsg);

    if (status === "error") {
      yield { type: "error", message: responseError?.message || "LLM error" };
      yield { type: "done", text: fullResponseText, turnTokens };
      return;
    }

    if (status === "stop") {
      yield { type: "done", text: fullResponseText, turnTokens };
      return;
    }

    if (status === "tool_calls") {
      continuations = 0;
      for (const tc of responseToolCalls) {
        yield { type: "tool_start", name: tc.name, args: tc.arguments };
      }

      const results = await Promise.all(
        responseToolCalls.map((tc) => executeTool(tc.name, tc.arguments))
      );

      for (let j = 0; j < responseToolCalls.length; j++) {
        const result = results[j];
        const tc = responseToolCalls[j];
        const preview = result.ok ? result.data.slice(0, 200) : result.error.message;
        yield { type: "tool_end", name: tc.name, result: preview, ok: result.ok };

        ctx.messages.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: tc.id,
        });
      }
      continue;
    }

    if (status === "length") {
      continuations++;
      if (continuations > MAX_CONTINUATIONS) {
        yield { type: "done", text: fullResponseText, turnTokens };
        return;
      }
      ctx.messages.push({
        role: "user",
        content: "Your previous response was cut off. Please continue from where you stopped.",
      });
      continue;
    }
  }

  yield { type: "done", text: fullResponseText, turnTokens };
}

function previewResult(result: ToolResult): string {
  if (result.ok) {
    return result.data.length > 200 ? result.data.slice(0, 200) + "..." : result.data;
  }
  return `${result.error.type}: ${result.error.message}`;
}

function logTurnSummary(turn: TokenUsage, session: TokenUsage): void {
  if (turn.totalTokens === 0) return;
  console.log(
    `\x1b[90m[turn tokens] ${turn.promptTokens} in / ${turn.completionTokens} out / ${turn.totalTokens} total\x1b[0m`,
  );
  console.log(
    `\x1b[90m[session tokens] ${session.promptTokens} in / ${session.completionTokens} out / ${session.totalTokens} total\x1b[0m`,
  );
}
