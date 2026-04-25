import type { Message, TokenUsage } from "./providers/index.js";
import { provider } from "./config.js";
import { tools, executeTool, type ToolResult } from "./tools.js";
import { isShuttingDown } from "./shutdown.js";

// ═══════════════════════════════════════════════════════════════════════════
// WHAT IS AN AGENT?
// ═══════════════════════════════════════════════════════════════════════════
//
// A normal LLM chat:
//   You ask → LLM answers → done.
//
// An agent:
//   You ask → LLM thinks → LLM says "I need to run a tool first"
//          → we run the tool → give result back to LLM
//          → LLM thinks again → maybe calls another tool
//          → ... keeps looping until it has a final answer.
//
// That's it. An "agent" is just a LOOP around an LLM that lets it
// call functions (tools) until it's satisfied.
//
// This file owns that loop and nothing else. Provider construction lives in
// config.ts, tool definitions in tools.ts, shutdown state in shutdown.ts,
// and the CLI wiring in main.ts. Swap any one of those and this file
// doesn't change.
// ═══════════════════════════════════════════════════════════════════════════


// ── Conversation history ───────────────────────────────────────────────────
//
// LLMs are stateless — they don't remember previous messages.
// We keep the full conversation in an array and send ALL of it every time.
// This is how the LLM "remembers" context.
//
// Exported so the REPL can push user turns onto it. Index 0 is the system
// prompt and must stay put — /clear resets everything after it.

export const messages: Message[] = [
  {
    role: "system",
    content: `You are a helpful assistant. You MUST use the provided tools to answer questions. NEVER describe what you would do — actually do it by calling the tools. Do NOT write code snippets. Call the tool directly.

Current working directory: ${process.cwd()}
If you don't know a file path, call list_directory first to discover it. NEVER guess paths.

Tool results are structured JSON of the form:
  {"ok": true, "data": "..."}
  {"ok": false, "error": {"type": "...", "message": "..."}}
When ok is false, read the error type and message, correct your inputs, and retry — do not give up on the first failure.`,
  },
];

// Wipe the conversation but keep the system prompt. Owned here so the
// "index 0 is the system message" invariant never leaks into the REPL.
export function clearConversation(): void {
  messages.length = 1;
  sessionTokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}


// ── Token accounting (#4) ──────────────────────────────────────────────────
//
// Module-level session total. We add per-call usage into it on every
// provider response. Surfacing this is how you catch two classes of bugs
// before they cost real money:
//   1. Runaway loops that keep calling the same tool and re-sending
//      the whole growing history (classic "context bloat" signature:
//      promptTokens climbs turn-over-turn even though user input didn't).
//   2. Models that silently switch from a cheap to an expensive tier
//      (e.g. a fallback kicked in and you didn't notice).
//
// Proper production version: per-tenant, persisted, alertable. Here: good
// enough to watch in the terminal and learn the habit of always logging it.

let sessionTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

function accumulate(target: TokenUsage, add: TokenUsage): void {
  target.promptTokens += add.promptTokens;
  target.completionTokens += add.completionTokens;
  target.totalTokens += add.totalTokens;
}


// ── The agent loop ─────────────────────────────────────────────────────────
//
// THIS IS THE CORE OF THE WHOLE THING.
//
// One call to agentTurn() handles a full user turn:
//   1. Send messages to LLM
//   2. If LLM wants to call tools → run them, add results, go to 1
//   3. If LLM is done (no tool calls) → print the answer, stop
//
// It's a while loop. That's all an agent is.

export async function agentTurn(): Promise<void> {
  const MAX_ITERATIONS = 10;
  // Configurable via env — lets users tune based on their model's max_tokens.
  const MAX_CONTINUATIONS = parseInt(process.env.MAX_CONTINUATIONS || "3", 10);

  let continuations = 0;

  // Per-turn tokens. Reset every user message so the "this turn cost X"
  // line is meaningful. Session total keeps climbing.
  const turnTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  for (let i = 0; i < MAX_ITERATIONS; i++) {

    // Bail early if the process is shutting down.
    if (isShuttingDown()) {
      console.log("\x1b[33m[agent] Interrupted, stopping gracefully.\x1b[0m");
      return;
    }

    // Call the LLM.
    console.log(`\x1b[90m  (calling ${provider.name}...)\x1b[0m`);
    const response = await provider.chat(messages, tools);

    // Per-call token log. Skip if the provider didn't report usage.
    if (response.usage) {
      accumulate(turnTokens, response.usage);
      accumulate(sessionTokens, response.usage);
      console.log(
        `\x1b[90m  (tokens: ${response.usage.promptTokens} in / ${response.usage.completionTokens} out / ${response.usage.totalTokens} total)\x1b[0m`,
      );
    }

    // Save what the LLM said into conversation history.
    const assistantMsg: Message = { role: "assistant", content: response.text };
    if (response.toolCalls.length > 0) {
      assistantMsg.tool_calls = response.toolCalls;
    }
    messages.push(assistantMsg);

    // If the LLM produced text, print it.
    if (response.text) {
      console.log(`\n\x1b[36massistant:\x1b[0m ${response.text}`);
    }

    // ── Decide what to do based on WHY the model stopped ─────────────
    //
    // response.status is the authoritative signal from the provider.
    // Four possible values:
    //   "stop"       → model chose to stop, it's done
    //   "tool_calls" → model wants us to execute tools
    //   "length"     → model hit max_tokens, response is INCOMPLETE
    //   "error"      → provider failed (auth, rate limit, bad request, etc.)

    switch (response.status) {

      case "error": {
        const err = response.error!;
        console.log(`\n\x1b[31m[agent] LLM API error (${err.type}): ${err.message}\x1b[0m`);

        if (err.type === "auth") {
          console.log("\x1b[31m[agent] Check your API key and try again.\x1b[0m");
        } else if (err.type === "context_length_exceeded") {
          console.log("\x1b[31m[agent] Conversation too long. Use /clear to reset.\x1b[0m");
        } else if (err.type === "rate_limited") {
          console.log("\x1b[33m[agent] Rate limited after retries. Wait a moment and try again.\x1b[0m");
        }

        logTurnSummary(turnTokens);
        return;
      }

      case "stop":
        // Model is done. This is the ONLY clean exit.
        logTurnSummary(turnTokens);
        return;

      case "tool_calls": {
        continuations = 0;

        for (const tc of response.toolCalls) {
          console.log(`\n\x1b[33m  [tool] ${tc.name}(\x1b[0m${JSON.stringify(tc.arguments)}\x1b[33m)\x1b[0m`);
        }

        const results = await Promise.all(
          response.toolCalls.map((tc) => executeTool(tc.name, tc.arguments))
        );

        for (let j = 0; j < response.toolCalls.length; j++) {
          const result = results[j];
          const tc = response.toolCalls[j];

          // Show a human-readable preview in the terminal. Different color
          // for errors so the eye catches failures at a glance.
          const preview = previewResult(result);
          const color = result.ok ? "\x1b[90m" : "\x1b[31m";
          console.log(`${color}  → [${tc.name}] ${preview}\x1b[0m`);

          // Feed the STRUCTURED result to the model as JSON. The system
          // prompt tells it how to read the envelope; giving it typed
          // errors (not a free-text "Error:" string) is the whole point
          // of #7.
          messages.push({
            role: "tool",
            content: JSON.stringify(result),
            tool_call_id: tc.id,
          });
        }

        // Loop back to call the LLM again with tool results.
        break;
      }

      case "length": {
        // ── Model got cut off mid-response (hit max_tokens) ────────────
        //
        // The model might have been mid-sentence or mid-tool-call JSON.
        // Old code saw "no tools" and silently returned incomplete output.
        //
        // Strategy: inject a continuation prompt and loop back.
        // Cap retries to avoid burning tokens on endlessly long responses.

        continuations++;

        if (continuations > MAX_CONTINUATIONS) {
          console.log("\x1b[31m[agent] Response was truncated and max continuations reached. Output may be incomplete.\x1b[0m");
          logTurnSummary(turnTokens);
          return;
        }

        console.log(`\x1b[33m[agent] Response truncated (hit max_tokens). Auto-continuing... (${continuations}/${MAX_CONTINUATIONS})\x1b[0m`);

        messages.push({
          role: "user",
          content: "Your previous response was cut off. Please continue from where you stopped.",
        });

        // Loop back so the model can finish.
        break;
      }
    }
  }

  console.log("\x1b[31m[agent] Hit max iterations, stopping.\x1b[0m");
  logTurnSummary(turnTokens);
}


// ── Display helpers ────────────────────────────────────────────────────────

// Short stringification of a tool result for the terminal. Never dumps the
// full raw JSON — that's what messages[].content is for.
function previewResult(result: ToolResult): string {
  if (result.ok) {
    return result.data.length > 200 ? result.data.slice(0, 200) + "..." : result.data;
  }
  return `${result.error.type}: ${result.error.message}`;
}

function logTurnSummary(turn: TokenUsage): void {
  // Only show the summary if the provider reported anything this turn.
  if (turn.totalTokens === 0) return;
  console.log(
    `\x1b[90m[turn tokens] ${turn.promptTokens} in / ${turn.completionTokens} out / ${turn.totalTokens} total\x1b[0m`,
  );
  console.log(
    `\x1b[90m[session tokens] ${sessionTokens.promptTokens} in / ${sessionTokens.completionTokens} out / ${sessionTokens.totalTokens} total\x1b[0m`,
  );
}
