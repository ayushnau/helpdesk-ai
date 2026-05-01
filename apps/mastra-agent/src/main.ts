import * as readline from "readline";
import dotenv from "dotenv";
dotenv.config();

import { helpdeskAgent } from "./agent.js";

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\x1b[32myou: \x1b[0m",
  });

  const modelId = process.env.MASTRA_MODEL || "ollama/qwen3:8b";
  console.log(`\nMastra Agent ready — helpdesk-agent (${modelId})`);
  console.log("Type a message to chat. Ctrl-C to exit.\n");
  rl.prompt();

  rl.on("line", async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }
    if (trimmed === "/quit") process.exit(0);

    try {
      process.stdout.write("\n\x1b[36mA:\x1b[0m ");

      const stream = await helpdeskAgent.stream(trimmed);

      for await (const chunk of stream.textStream) {
        process.stdout.write(chunk);
      }

      process.stdout.write("\n\n");
    } catch (err: unknown) {
      console.error("\n\x1b[31m[error]\x1b[0m", err instanceof Error ? err.message : err);
    }

    rl.prompt();
  });

  rl.on("close", () => { console.log("\nBye!"); process.exit(0); });
}

main();
