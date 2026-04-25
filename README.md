# helpdesk-ai

A minimal, well-commented **CLI agent** that talks to any OpenAI-compatible LLM
(Ollama, Groq, Gemini, …) and can call **tools** to read/write files, list
directories, and search text on your local machine.

The codebase is intentionally small and split into focused files so you can read
it end-to-end in one sitting and understand exactly what an "agent loop" really
is.

---

## What is this?

A normal LLM chat is one shot: you ask, it answers, done.

An **agent** is a loop:

1. You ask.
2. The LLM thinks and may say "I need to run a tool first".
3. We run the tool and feed the result back to the LLM.
4. The LLM thinks again — maybe calls another tool, maybe answers.
5. Repeat until it produces a final answer (or hits a stop condition).

That loop lives in `agent.ts`. Everything else exists to support it.

---

## Project layout

```
helpdesk-ai/
├── main.ts              CLI entry point — REPL that reads stdin and drives the agent
├── agent.ts             The agent loop itself (call LLM → run tools → repeat)
├── tools.ts             Tool registry: read_file, write_file, list_directory, search_text
├── config.ts            Provider selection (ollama | gemini | groq) from argv + env
├── shutdown.ts          SIGINT/SIGTERM handling for graceful Ctrl-C
├── providers/
│   ├── types.ts         Shared types: Message, ToolDef, ToolCall, ProviderResponse
│   ├── openai-compat.ts One implementation that works for every OpenAI-compatible API
│   └── index.ts         Public re-exports
├── package.json
├── tsconfig.json
├── .env.example         Template for required/optional env vars
└── .env                 Your local secrets (gitignored — don't commit)
```

Each file has a single responsibility. Swap any one of them and the others
don't change.

---

## Requirements

- **Node.js 20+** (uses the built-in `fetch` and modern `process` APIs)
- One of:
  - **Ollama** running locally on `http://localhost:11434` (default, free, offline)
  - A **Groq API key** (fast cloud inference)
  - A **Gemini API key** (Google cloud inference)

---

## Setup

```bash
cd helpdesk-ai
npm install
cp .env.example .env
```

Then open `.env` and fill in whichever keys you want to use:

```
GEMINI_API_KEY=...      # only needed if you run with `gemini`
GROQ_API_KEY=...        # only needed if you run with `groq`
OLLAMA_HOST=http://localhost:11434/v1   # optional, defaults to this
```

---

## Running

The CLI takes two optional positional args: `<backend> <model>`.

```bash
# Local Ollama with the default model (qwen2.5:7b)
npx tsx main.ts

# Local Ollama with a different model
npx tsx main.ts ollama mistral

# Groq cloud (default model: llama-3.3-70b-versatile)
npx tsx main.ts groq

# Gemini cloud (default model: gemini-2.0-flash)
npx tsx main.ts gemini
```

Or via the npm script (defaults to Ollama):

```bash
npm start
```

You should see:

```
Agent ready — groq/llama-3.3-70b-versatile
Type a message to chat. Ctrl-C to exit.

you:
```

### REPL commands

| Command  | What it does                                         |
| -------- | ---------------------------------------------------- |
| `/clear` | Wipe conversation history (system prompt is kept)    |
| `/quit`  | Exit cleanly                                         |
| `Ctrl-C` | Graceful shutdown; second Ctrl-C force-kills         |

---

## Available tools

The agent can ask to call any of these. Schemas are defined with **Zod** in
`tools.ts` and validated at the boundary, so the LLM can't crash the process
by sending bad arguments.

| Tool             | Description                                                   |
| ---------------- | ------------------------------------------------------------- |
| `read_file`      | Read a file's contents (truncated at 50 KB)                   |
| `write_file`     | Create or overwrite a file (creates parent dirs as needed)    |
| `list_directory` | List entries in a directory                                   |
| `search_text`    | Literal text search via `grep -rIn` (no shell interpolation)  |

> **Note on security:** there is intentionally no general `run_command` tool.
> A free-form shell is a prompt-injection footgun — a crafted message could
> trick a compliant model into running `rm -rf ~`. The four narrow tools above
> cover the common cases without that attack surface.

### Adding a new tool

Add one object to the `TOOL_REGISTRY` array in `tools.ts`:

```ts
const myTool: Tool<{ foo: string }> = {
  name: "my_tool",
  description: "What it does — this is the only hint the LLM gets.",
  inputSchema: z.object({
    foo: z.string().describe("What foo means"),
  }),
  async execute({ foo }) {
    return `did something with ${foo}`;
  },
};

const TOOL_REGISTRY: Tool<any>[] = [readFile, writeFile, listDirectory, searchText, myTool];
```

The JSON Schema the LLM sees is derived from the Zod schema, so there's a
single source of truth for both validation and the tool's contract.

---

## How a turn works (the agent loop)

`agentTurn()` in `agent.ts` runs a `for` loop, capped at 10 iterations:

1. Send the full conversation history + tool definitions to the provider.
2. Look at `response.status`:
   - `"stop"` → the model is done. Print the answer and return.
   - `"tool_calls"` → run every requested tool **in parallel**, append each
     structured `ToolResult` to the history, loop back to step 1.
   - `"length"` → the response was truncated by `max_tokens`. Inject a
     "please continue" message and loop back (capped by `MAX_CONTINUATIONS`,
     default 3).
3. If we hit 10 iterations without finishing, log a warning and return.

Every iteration also accumulates token usage (per turn and per session) so you
can see runaway loops or context bloat directly in the terminal.

### Structured tool results

Tools never return a free-text `"Error: ..."` string. They return a typed
discriminated union:

```ts
{ ok: true,  data: "..." }
{ ok: false, error: { type: "not_found" | "validation_error" | ..., message: "..." } }
```

The model is told about this envelope in the system prompt, which makes it
much better at recovering from failures (e.g. retrying with a corrected path
on `not_found` instead of giving up).

---

## Providers

Every backend supported here speaks the **OpenAI-compatible** REST API
(`POST /v1/chat/completions`). Only three things differ between them: base URL,
API key, and model name. So instead of duplicating ~150 lines per provider, we
have one `createOpenAICompatProvider({ baseUrl, apiKey, model })` factory in
`providers/openai-compat.ts`.

It also handles:

- **Retries with full-jitter exponential backoff** for `429` and `5xx` responses
  and for network errors (DNS/TCP/TLS).
- **`Retry-After`** header honoring (both seconds and HTTP-date formats).
- **No retries** for `400`/`401`/`403`/`404`/`422` — those won't get better.
- Normalization of `usage` to camelCase, with `null` when the provider doesn't
  report it.

Want a new provider? Add a `case` in `pickProvider()` in `config.ts`.

---

## Environment variables

| Variable             | Required?                  | Purpose                                  |
| -------------------- | -------------------------- | ---------------------------------------- |
| `GROQ_API_KEY`       | Required for `groq`        | Auth header for Groq's API               |
| `GEMINI_API_KEY`     | Required for `gemini`      | Auth header for Gemini's OpenAI endpoint |
| `OLLAMA_HOST`        | Optional                   | Override default `http://localhost:11434/v1` |
| `MAX_CONTINUATIONS`  | Optional (default `3`)     | How many times to auto-continue truncated responses |

---

## Troubleshooting

**`Set GROQ_API_KEY env var first`**
You ran `npx tsx main.ts groq` without setting the key. Add it to `.env`.

**Ollama: `ECONNREFUSED 127.0.0.1:11434`**
Ollama isn't running. Start it with `ollama serve`, and make sure you've
pulled the model first (`ollama pull qwen2.5:7b`).

**`Hit max iterations, stopping.`**
The model got stuck in a tool-calling loop. Check the terminal log to see
which tool it kept calling — often a sign the tool description is unclear or
the model is guessing paths instead of listing first.

**Token counts climbing fast across turns**
That's context bloat — the conversation history is growing every turn. Use
`/clear` between unrelated questions.

---

## License

ISC
