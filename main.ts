dotenv.config();
import * as readline from "readline";
import dotenv from "dotenv";
import { provider } from "./config.js";
import { messages, agentTurn, clearConversation } from "./agent.js";
import { registerShutdownHandlers } from "./shutdown.js";

// Load .env before anything reads process.env. config.ts does this too,
// but putting it here makes the entry point's contract explicit.

// ── Entry point: the REPL (read-eval-print loop) ───────────────────────────
//
// This file is the CLI. It reads lines from the terminal and hands each line
// to the agent. Replace this with an Express route, a Slack adapter, or an
// MCP server and nothing inside agent.ts has to change — that's the whole
// reason the loop lives in a separate file.

// Install signal handlers once, at startup. agent.ts only reads the flag;
// the REPL is what owns the process lifecycle.
registerShutdownHandlers();

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
      clearConversation();
      console.log("Cleared.");
      rl.prompt();
      return;
    }

    // Append the user's turn to the shared history, then let the agent
    // run until it produces a final answer (or hits a stop condition).
    messages.push({ role: "user", content: trimmed });

    try {
      await agentTurn();
    } catch (err: unknown) {
      console.log(err)
      console.error("\x1b[31m[error]\x1b[0m", err instanceof Error ? err.message : err);
    }

    rl.prompt();
  });

  rl.on("close", () => { console.log("\nBye!"); process.exit(0); });
}

main();
