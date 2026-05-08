import { encodingForModel } from "js-tiktoken";
import type { Message, Provider } from "./providers/index.js";

// cl100k_base works for GPT-4/3.5 — close enough for any model when we just
// need an approximate count to decide "should we summarize yet?"
const enc = encodingForModel("gpt-4o");

// ── Token Counting ──────────────────────────────────────────────────────────

/** Approximate token count for a single message (content + role overhead) */
function messageTokens(msg: Message): number {
  // Every message has ~4 tokens of framing overhead (role, separators)
  let count = 4;
  count += enc.encode(msg.content).length;

  // Tool calls can be very token-heavy — count the serialized JSON
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      count += enc.encode(JSON.stringify(tc)).length;
    }
  }

  return count;
}

/** Total approximate tokens for an array of messages */
export function countTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += messageTokens(msg);
  }
  return total;
}

// ── Summarization ───────────────────────────────────────────────────────────

const SUMMARIZE_PROMPT = `You are a conversation summarizer for a helpdesk AI agent.
Summarize the conversation below, preserving:
- The user's core question or intent
- Key facts the user mentioned (plan, product, error messages, what they already tried)
- Decisions made or solutions proposed
- Any unresolved issues

Be concise — aim for 3-8 bullet points. Do NOT include greetings or filler.
If a previous summary exists, merge it with the new information — don't repeat what's already captured.`;

/**
 * Calls the LLM to summarize a batch of older messages.
 * If there's an existing summary, it's included so the LLM merges rather than restarts.
 */
export async function summarizeMessages(
  oldMessages: Message[],
  existingSummary: string | null,
  provider: Provider,
): Promise<string> {
  // Build a readable transcript of the messages to summarize
  const transcript = oldMessages
    .filter((m) => m.role !== "system") // system prompt doesn't need summarizing
    .map((m) => {
      if (m.role === "tool") return `[tool result]: ${m.content.slice(0, 500)}`;
      if (m.tool_calls) return `assistant: [called tools: ${m.tool_calls.map((t) => t.name).join(", ")}]`;
      return `${m.role}: ${m.content}`;
    })
    .join("\n");

  const userContent = existingSummary
    ? `PREVIOUS SUMMARY:\n${existingSummary}\n\nNEW MESSAGES TO INCORPORATE:\n${transcript}`
    : `CONVERSATION TO SUMMARIZE:\n${transcript}`;

  const response = await provider.chat(
    [
      { role: "system", content: SUMMARIZE_PROMPT },
      { role: "user", content: userContent },
    ],
    [], // no tools needed for summarization
  );

  return response.text;
}

// ── Conversation Compression ────────────────────────────────────────────────

export interface MemoryState {
  summary: string | null;
}

/**
 * The core compression logic. Called before each agent turn.
 *
 * How it works:
 * 1. Count tokens in [system prompt + summary + all conversation messages]
 * 2. If under threshold → do nothing
 * 3. If over threshold → find how many old messages to summarize so that
 *    the remaining messages + new summary fit under the threshold
 * 4. Call LLM to summarize the old messages
 * 5. Remove summarized messages from the array, inject summary as a system-level message
 *
 * The messages array is mutated in place (same pattern as the rest of agent.ts).
 */
export async function compressIfNeeded(
  messages: Message[],
  memoryState: MemoryState,
  provider: Provider,
  maxTokens: number,
  // How much of the context window to use before triggering compression
  threshold = 0.75,
): Promise<boolean> {
  const tokenLimit = Math.floor(maxTokens * threshold);
  const currentCount = countTokens(messages) + countTokens(
    memoryState.summary ? [{ role: "system", content: memoryState.summary }] : [],
  );

  if (currentCount <= tokenLimit) return false; // no compression needed

  // Find the system prompt (index 0) and conversation messages (index 1+)
  const systemMsg = messages[0]; // always the system prompt
  const conversationMsgs = messages.slice(1);

  // We want to keep at least the most recent N messages verbatim.
  // Start by keeping the last 6 messages (3 turns), then check if that's enough.
  const MIN_KEEP = 6;
  const keepCount = Math.min(MIN_KEEP, conversationMsgs.length);

  if (conversationMsgs.length <= keepCount) {
    // Not enough messages to summarize — nothing we can do
    return false;
  }

  const toSummarize = conversationMsgs.slice(0, conversationMsgs.length - keepCount);
  const toKeep = conversationMsgs.slice(conversationMsgs.length - keepCount);

  console.log(
    `\x1b[33m[memory] Compressing: summarizing ${toSummarize.length} messages, keeping ${toKeep.length} recent\x1b[0m`,
  );

  // Call LLM to produce a summary
  const newSummary = await summarizeMessages(toSummarize, memoryState.summary, provider);
  memoryState.summary = newSummary;

  // Rebuild the messages array in place:
  // [system prompt] [summary as system msg] [recent messages]
  messages.length = 0;
  messages.push(systemMsg);
  messages.push({
    role: "system",
    content: `CONVERSATION SUMMARY (earlier messages have been compressed):\n${newSummary}`,
  });
  messages.push(...toKeep);

  const newCount = countTokens(messages);
  console.log(
    `\x1b[33m[memory] Compressed: ${currentCount} → ${newCount} tokens\x1b[0m`,
  );

  return true; // compression happened
}
