import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import type { Provider, Message, ToolDef } from "./providers/index.js";
import { createOpenAICompatProvider } from "./providers/index.js";
import dotenv from "dotenv";
dotenv.config();

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
// ═══════════════════════════════════════════════════════════════════════════


// ── Step 1: Pick a provider ─────────────────────────────────────────────────
//
// All these providers speak the SAME "OpenAI-compatible" API format.
// Only 3 things change between them: URL, API key, model name.
// So we use ONE function (createOpenAICompatProvider) for all of them.
//
//   npx tsx agent.ts                   → ollama / qwen2.5:7b  (local)
//   npx tsx agent.ts ollama mistral    → ollama / mistral     (local)
//   npx tsx agent.ts gemini            → gemini-2.0-flash     (cloud)
//   npx tsx agent.ts groq              → llama-3.3-70b        (cloud)

function pickProvider(): Provider {
  const [, , backend, model] = process.argv;

  switch (backend) {
    case "gemini":
      return createOpenAICompatProvider({
        name: `gemini/${model || "gemini-2.0-flash"}`,
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: model || "gemini-2.0-flash",
        apiKey: requireEnv("GEMINI_API_KEY"),
      });

    case "groq":
      return createOpenAICompatProvider({
        name: `groq/${model || "llama-3.3-70b-versatile"}`,
        baseUrl: "https://api.groq.com/openai/v1",
        model: model || "llama-3.3-70b-versatile",
        apiKey: requireEnv("GROQ_API_KEY"),
      });

    case "ollama":
    default:
      return createOpenAICompatProvider({
        name: `ollama/${model || "qwen2.5:7b"}`,
        baseUrl: "http://localhost:11434/v1",
        model: model || "qwen2.5:7b",
        // no API key — Ollama runs locally
      });
  }
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Set ${name} env var first`);
  return val;
}

const provider = pickProvider();


// ── Step 2: Define the tools ────────────────────────────────────────────────
//
// Tools are functions the LLM can request us to run.
// We describe each tool with:
//   - name: what to call it
//   - description: so the LLM knows WHEN to use it
//   - parameters: what inputs it takes (JSON Schema)
//
// The LLM never runs these itself — it just says
// "hey, please run read_file with path=foo.txt" and we do it.

const tools: ToolDef[] = [
  {
    name: "read_file",
    description: "Read the contents of a file at the given path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative file path" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write content to a file. Creates or overwrites the file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to write" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    description: "List files and directories at the given path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path (defaults to cwd)" },
      },
      required: [],
    },
  },
  {
    name: "run_command",
    description: "Run a shell command and return its output.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
      },
      required: ["command"],
    },
  },
];


// ── Step 3: Tool execution ──────────────────────────────────────────────────
//
// When the LLM asks to run a tool, this function actually does it.
// It's just a big switch statement — match the tool name, do the work.
//
// It's async so we can add async tools later (API calls, DB queries, etc.)
// without changing the agent loop.

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    switch (name) {
      case "read_file": {
        const content = fs.readFileSync(path.resolve(input.path as string), "utf-8");
        return content.length > 50_000
          ? content.slice(0, 50_000) + "\n... [truncated]"
          : content;
      }
      case "write_file": {
        const filePath = path.resolve(input.path as string);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, input.content as string, "utf-8");
        return `Wrote ${filePath}`;
      }
      case "list_directory": {
        const dirPath = input.path && typeof input.path === "string" ? input.path : ".";
        const entries = fs.readdirSync(path.resolve(dirPath), { withFileTypes: true });
        return entries.map((e) => `${e.isDirectory() ? "d" : "f"}  ${e.name}`).join("\n") || "(empty)";
      }
      case "run_command": {
        return execSync(input.command as string, {
          encoding: "utf-8", timeout: 10_000, maxBuffer: 1024 * 1024,
        }) || "(no output)";
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: unknown) {
    return `Error: ${err instanceof Error ? err.message : err}`;
  }
}


// ── Step 4: The conversation history ────────────────────────────────────────
//
// LLMs are stateless — they don't remember previous messages.
// We keep the full conversation in an array and send ALL of it every time.
// This is how the LLM "remembers" context.

const messages: Message[] = [
  {
    role: "system",
    content: `You are a helpful assistant. You MUST use the provided tools to answer questions. NEVER describe what you would do — actually do it by calling the tools. Do NOT write code snippets. Call the tool directly.

Current working directory: ${process.cwd()}
If you don't know a file path, call list_directory first to discover it. NEVER guess paths.`,
  },
];


// ── Step 5: The agent loop ──────────────────────────────────────────────────
//
// THIS IS THE CORE OF THE WHOLE THING.
//
// One call to agentTurn() handles a full user turn:
//   1. Send messages to LLM
//   2. If LLM wants to call tools → run them, add results, go to 1
//   3. If LLM is done (no tool calls) → print the answer, stop
//
// It's a while loop. That's all an agent is.

async function agentTurn(): Promise<void> {
  const MAX_ITERATIONS = 10;

  for (let i = 0; i < MAX_ITERATIONS; i++) {

    // Call the LLM
    console.log(`\x1b[90m  (calling ${provider.name}...)\x1b[0m`);
    const response = await provider.chat(messages, tools);

    // Save what the LLM said into conversation history
    const assistantMsg: Message = { role: "assistant", content: response.text };
    if (response.toolCalls.length > 0) {
      assistantMsg.tool_calls = response.toolCalls;
    }
    messages.push(assistantMsg);

    // If the LLM produced text, print it
    if (response.text) {
      console.log(`\n\x1b[36massistant:\x1b[0m ${response.text}`);
    }

    // ── No tool calls? We're done. ────────────────────────────────────
    if (response.toolCalls.length === 0) {
      return;
    }

    // ── LLM wants to call tools — execute ALL of them in parallel ────
    //
    // Why is this safe? Because the LLM already handled dependencies.
    // If tool B needed tool A's output, the LLM would have only returned
    // tool A in this response, waited for the result, then asked for tool B
    // in the NEXT loop iteration.
    //
    // Everything in a single response.toolCalls is independent by definition.

    // Log what we're about to run
    for (const tc of response.toolCalls) {
      console.log(`\n\x1b[33m  [tool] ${tc.name}(\x1b[0m${JSON.stringify(tc.arguments)}\x1b[33m)\x1b[0m`);
    }

    // Run all tools at the same time
    const results = await Promise.all(
      response.toolCalls.map((tc) => executeTool(tc.name, tc.arguments))
    );

    // Add all results to conversation history
    for (let j = 0; j < response.toolCalls.length; j++) {
      const result = results[j];
      const preview = result.length > 200 ? result.slice(0, 200) + "..." : result;
      console.log(`\x1b[90m  → [${response.toolCalls[j].name}] ${preview}\x1b[0m`);

      messages.push({
        role: "tool",
        content: result,
        tool_call_id: response.toolCalls[j].id,
      });
    }

    // Now we loop back to the top — send everything (including tool results)
    // back to the LLM so it can continue.
  }

  console.log("\x1b[31m[agent] Hit max iterations, stopping.\x1b[0m");
}


// ── Step 6: The REPL (read-eval-print loop) ─────────────────────────────────
//
// Just reads lines from the terminal, feeds them to the agent loop.

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\x1b[32myou: \x1b[0m",
  });

  console.log(`\nAgent ready — ${provider.name}`);
  console.log("Type a message to chat. Ctrl-C to exit.\n");
  rl.prompt();

  rl.on("line", async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }
    if (trimmed === "/quit") process.exit(0);
    if (trimmed === "/clear") {
      messages.length = 1; // keep system prompt
      console.log("Cleared.");
      rl.prompt();
      return;
    }

    // Add user message to history
    messages.push({ role: "user", content: trimmed });

    try {
      await agentTurn();
    } catch (err: unknown) {
      console.error("\x1b[31m[error]\x1b[0m", err instanceof Error ? err.message : err);
    }

    rl.prompt();
  });

  rl.on("close", () => { console.log("\nBye!"); process.exit(0); });
}

main();
