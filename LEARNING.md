# Learning Log

## Session 1: Building an Agent Loop from Scratch

### What is an agent?

A normal chatbot: you ask, it answers, done.

An agent: you ask, the LLM **loops** — it can call tools (functions), see results, think again, call more tools — until it has a final answer. That's it. An agent is a **while loop around an LLM**.

### Concepts covered

#### 1. ReAct Pattern (Reason + Act)
- **What:** The LLM reasons about what to do, acts by calling a tool, observes the result, then repeats.
- **Where in code:** `agentTurn()` in `agent.ts` — a `for` loop that keeps calling the LLM until `toolCalls.length === 0`.
- **Key insight:** The LLM never runs tools itself. It outputs structured JSON saying "please call X with args Y." We execute it and feed the result back.

#### 2. Tool Use (Function Calling)
- **What:** We describe tools as JSON Schema (name, description, parameters). The LLM reads these descriptions to decide which tool to use and what arguments to pass.
- **Where in code:** `tools[]` array defines them, `executeTool()` runs them.
- **Key insight:** The description matters a lot. The LLM picks tools based on the `description` field. Bad description = LLM won't use it, or will use it wrong.
- **Lesson learned:** Small models (mistral 7B) often fail at tool calling — they describe what they'd do instead of emitting the structured `tool_calls` JSON. Model choice matters. `qwen2.5:7b` is much better at this.

#### 3. Conversation History (Stateless LLMs)
- **What:** LLMs don't remember anything between API calls. We keep a `messages[]` array with every message (system, user, assistant, tool results) and send ALL of it on every request.
- **Where in code:** `const messages: Message[]` — gets appended to after every interaction.
- **Key insight:** This is why long conversations get expensive — you're resending everything every time. Also why "context window" limits matter.

#### 4. System Prompt
- **What:** The first message in the conversation. Sets the LLM's behavior, personality, and rules.
- **Where in code:** First entry in `messages[]` with `role: "system"`.
- **Lesson learned:** Wording matters hugely. With mistral, a soft prompt ("use tools when helpful") didn't work. A forceful prompt ("you MUST use tools, NEVER describe what you'd do") still didn't work because the model itself was weak at tool calling.

#### 5. Provider Abstraction (OpenAI-Compatible API)
- **What:** Ollama, Gemini, Groq, OpenAI all use the same REST API format (`POST /v1/chat/completions`). So we wrote ONE provider that works for all of them by just swapping URL, API key, and model name.
- **Where in code:** `providers/openai-compat.ts` — one file, handles everything. New providers are just 6 lines in the `switch` statement in `agent.ts`.
- **Key insight:** Don't duplicate code when the only difference is config. We initially had separate `ollama.ts` and `gemini.ts` files with identical logic — bad. Merged into one.

#### 6. REPL vs ReAct
- **REPL** (Read-Eval-Print Loop) = a UI pattern. Reads terminal input, processes it, shows output. Nothing to do with AI. Our `main()` function.
- **ReAct** (Reason + Act) = an agent pattern. LLM thinks, calls tools, observes, repeats. Our `agentTurn()` function.
- They're nested: REPL calls ReAct. They're independent — you could put ReAct behind a web server instead of a REPL.

### Architecture

```
agent.ts                          — REPL + agent loop + tools
providers/
  types.ts                        — Provider interface (what every LLM backend must implement)
  openai-compat.ts                — One implementation that handles Ollama/Gemini/Groq/etc.
  index.ts                        — barrel export
```

#### 7. Sequential vs Parallel Tool Calls
- **Sequential:** LLM calls one tool, waits for the result, then decides what to do next. Each tool call depends on the previous result.
  - Example: "Read package.json and explain the main script" → first `read_file("package.json")`, see the result, then answer.
- **Parallel:** LLM calls multiple tools at once in a single response. The tools don't depend on each other.
  - Example: "What's in package.json and tsconfig.json?" → LLM returns `tool_calls: [read_file("package.json"), read_file("tsconfig.json")]` in ONE response. We run both, send both results back together.
- **Where in code:** `agentTurn()` uses `Promise.all()` to run all tool calls from one response in parallel. The loop iterations (calling the LLM again) handle sequential dependencies.
- **Why is Promise.all safe here?** The LLM already figured out dependencies for us. If tool B depends on tool A's result, the LLM would only return tool A, wait for its result in the next iteration, THEN return tool B. Everything within a single `response.toolCalls` is independent by definition.
- **Who decides?** The LLM decides. If it thinks two tool calls are independent, it emits them together. If one depends on the other, it emits one, waits for the result, then emits the next.
- **Key insight:** Parallel = faster (one round trip instead of two) but only works when tools don't depend on each other. Sequential = slower but necessary when step 2 needs the output of step 1.

```
Sequential (2 round trips):
  LLM → "call read_file(package.json)" → result → LLM → "call read_file(tsconfig.json)" → result → LLM → answer

Parallel (1 round trip):
  LLM → "call read_file(package.json) AND read_file(tsconfig.json)" → both results → LLM → answer
```

#### 8. Model Quality and Tool Calling
- **What we observed:** mistral:7b and qwen2.5:7b described what they'd do ("I would call read_file...") instead of actually emitting `tool_calls` JSON. Groq's llama-3.3-70b did it correctly.
- **Why:** Tool calling requires the model to output a specific structured JSON format instead of natural language. Smaller models aren't trained enough on this format. A 70b model has seen vastly more examples of structured output during training.
- **Key insight:** Model selection is an engineering decision, not just a quality preference. A model that can't reliably emit tool calls is useless for agents regardless of how smart its text answers are.

#### 9. LLM Self-Correction
- **What happened:** Groq sent `list_directory(null)` → our tool crashed → error message went back into `messages[]` → LLM saw the error → retried with a valid path. It self-corrected.
- **Why it worked:** The error string was informative ("Cannot read properties of null"), and the loop gave it another iteration to try again.
- **Two layers of defense:**
  1. **Defensive tool code** — handle bad inputs (e.g. default `null` to `"."`) so the tool doesn't crash. Prevents wasted API calls.
  2. **Self-correction via the loop** — even if a tool returns an error, the LLM can adjust and retry. Safety net for edge cases you didn't anticipate.
- **Key insight:** Both layers are needed. Defensive code saves cost (no wasted round trip). The loop saves reliability (handles cases you didn't think of). Belt and suspenders.

#### 10. Grounding
- **What:** LLMs don't know anything about their environment — the cwd, OS, file structure, nothing. They'll hallucinate paths like `/home/user/project/package.json`.
- **Fix:** Put real environment facts in the system prompt (cwd, available tools). This is called "grounding" — anchoring the LLM to reality.
- **Anti-pattern:** Injecting entire file listings into the prompt. That defeats the purpose of tools — the LLM should discover information by calling `list_directory`, not have it spoon-fed. Only inject what the LLM genuinely cannot discover on its own (like cwd).

### What the agent loop actually does (step by step)

```
1. User types "read package.json and list dependencies"
2. We add { role: "user", content: "..." } to messages[]
3. agentTurn() starts:
   a. Send all messages[] to LLM
   b. LLM responds with: tool_calls: [{ name: "read_file", args: { path: "package.json" } }]
   c. We run read_file("package.json"), get the file contents
   d. We add the assistant response AND tool result to messages[]
   e. Loop back to (a) — send everything again
   f. LLM now sees the file contents, responds with text: "You have these dependencies: ..."
   g. No tool_calls → loop ends
4. Print the answer
5. REPL prompts for next input
```
