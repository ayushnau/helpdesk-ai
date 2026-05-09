import type { Message, TokenUsage, ToolCall, ProviderResponse, ProviderError, Provider } from "./providers/index.js";
import { provider as defaultProvider } from "./config.js";
import { tools, executeTool, type ToolResult } from "./tools.js";
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

export async function agentTurn(
  ctx: ConversationContext = defaultContext,
  activeProvider: Provider = defaultProvider,
): Promise<AgentTurnResult> {
  const MAX_ITERATIONS = 10;
  const MAX_CONTINUATIONS = parseInt(process.env.MAX_CONTINUATIONS || "3", 10);

  let continuations = 0;
  let fullResponseText = "";

  const turnTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for (let i = 0; i < MAX_ITERATIONS; i++) {

    if (isShuttingDown()) {
      console.log("\x1b[33m[agent] Interrupted, stopping gracefully.\x1b[0m");
      return { text: fullResponseText, turnTokens };
    }

    // Compress conversation history if approaching context window limit.
    await compressIfNeeded(ctx.messages, ctx.memoryState, activeProvider, MAX_CONTEXT_TOKENS);

    console.log(`\x1b[90m  (calling ${activeProvider.name}...)\x1b[0m`);

    let text = "";
    let responseToolCalls: ToolCall[] = [];
    let status: ProviderResponse["status"] = "stop";
    let responseUsage: TokenUsage | null = null;
    let responseError: ProviderError | undefined;

    if (activeProvider.chatStream) {
      let firstText = true;

      for await (const event of activeProvider.chatStream(ctx.messages, tools)) {
        switch (event.type) {
          case "text":
            if (firstText) {
              process.stdout.write(`\n\x1b[36massistant:\x1b[0m `);
              firstText = false;
            }
            process.stdout.write(event.token);
            text += event.token;
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

      if (!firstText) process.stdout.write("\n");

    } else {
      const response = await activeProvider.chat(ctx.messages, tools);
      text = response.text;
      responseToolCalls = response.toolCalls;
      status = response.status;
      responseUsage = response.usage;
      responseError = response.error;

      if (text) {
        console.log(`\n\x1b[36massistant:\x1b[0m ${text}`);
      }
    }

    if (responseUsage) {
      accumulate(turnTokens, responseUsage);
      accumulate(ctx.tokenUsage, responseUsage);
      console.log(
        `\x1b[90m  (tokens: ${responseUsage.promptTokens} in / ${responseUsage.completionTokens} out / ${responseUsage.totalTokens} total)\x1b[0m`,
      );
    }

    fullResponseText += text;

    const assistantMsg: Message = { role: "assistant", content: text };
    if (responseToolCalls.length > 0) {
      assistantMsg.tool_calls = responseToolCalls;
    }
    ctx.messages.push(assistantMsg);

    switch (status) {

      case "error": {
        const err = responseError!;
        console.log(`\n\x1b[31m[agent] LLM API error (${err.type}): ${err.message}\x1b[0m`);

        if (err.type === "auth") {
          console.log("\x1b[31m[agent] Check your API key and try again.\x1b[0m");
        } else if (err.type === "context_length_exceeded") {
          console.log("\x1b[31m[agent] Conversation too long. Use /clear to reset.\x1b[0m");
        } else if (err.type === "rate_limited") {
          console.log("\x1b[33m[agent] Rate limited after retries. Wait a moment and try again.\x1b[0m");
        }

        logTurnSummary(turnTokens, ctx.tokenUsage);
        return { text: fullResponseText, turnTokens };
      }

      case "stop":
        logTurnSummary(turnTokens, ctx.tokenUsage);
        return { text: fullResponseText, turnTokens };

      case "tool_calls": {
        continuations = 0;

        for (const tc of responseToolCalls) {
          console.log(`\n\x1b[33m  [tool] ${tc.name}(\x1b[0m${JSON.stringify(tc.arguments)}\x1b[33m)\x1b[0m`);
        }

        const results = await Promise.all(
          responseToolCalls.map((tc) => executeTool(tc.name, tc.arguments))
        );

        for (let j = 0; j < responseToolCalls.length; j++) {
          const result = results[j];
          const tc = responseToolCalls[j];

          const preview = previewResult(result);
          const color = result.ok ? "\x1b[90m" : "\x1b[31m";
          console.log(`${color}  → [${tc.name}] ${preview}\x1b[0m`);

          ctx.messages.push({
            role: "tool",
            content: JSON.stringify(result),
            tool_call_id: tc.id,
          });
        }

        break;
      }

      case "length": {
        continuations++;

        if (continuations > MAX_CONTINUATIONS) {
          console.log("\x1b[31m[agent] Response was truncated and max continuations reached. Output may be incomplete.\x1b[0m");
          logTurnSummary(turnTokens, ctx.tokenUsage);
          return { text: fullResponseText, turnTokens };
        }

        console.log(`\x1b[33m[agent] Response truncated (hit max_tokens). Auto-continuing... (${continuations}/${MAX_CONTINUATIONS})\x1b[0m`);

        ctx.messages.push({
          role: "user",
          content: "Your previous response was cut off. Please continue from where you stopped.",
        });

        break;
      }
    }
  }

  console.log("\x1b[31m[agent] Hit max iterations, stopping.\x1b[0m");
  logTurnSummary(turnTokens, ctx.tokenUsage);
  return { text: fullResponseText, turnTokens };
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
