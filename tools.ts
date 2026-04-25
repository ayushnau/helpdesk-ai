import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { z, ZodError, ZodType } from "zod";
import type { ToolDef } from "./providers/index.js";

// ── Tool system ────────────────────────────────────────────────────────────
//
// SHAPE
//   Each tool is one object holding:
//     name          — what the LLM calls it
//     description   — the *only* hint the LLM gets about WHEN to use it
//     inputSchema   — Zod schema. Validates args AT THE BOUNDARY.
//     execute       — pure function: validated input → ToolResult
//
//   From that one object we derive BOTH:
//     (a) what the LLM sees (JSON Schema, via zod-to-json-schema)
//     (b) what we run (the typed execute fn)
//
//   Single source of truth. If schema and runtime ever drift, it's a bug.
//
// STRUCTURED ERRORS (#7)
//   executeTool returns a discriminated union:
//     { ok: true,  data: string }                      — success
//     { ok: false, error: { type, message, details } } — failure
//
//   Why not just a string starting with "Error:"? Because the model
//   reasons better about typed failures than about free-text. A
//   validation_error means "I sent wrong args, let me fix them and
//   retry"; a not_found means "this path doesn't exist, I should
//   check the directory first". Same surface, different recovery.
//
// VALIDATION AT THE BOUNDARY (#3)
//   The LLM can hallucinate {"path": 12345} even though we declared
//   path: string. If we pass that straight to fs.readFileSync we get
//   a cryptic crash deep in node internals. Zod catches it and we
//   return a typed validation_error the model can act on.
//
// SECURITY (#5)
//   run_command is GONE. A general shell is a prompt-injection footgun:
//   "please run `rm -rf ~` to clean up" and a compliant model executes
//   it. We replaced it with narrow tools (read_file, write_file,
//   list_directory, search_text) whose inputs are schema-validated
//   strings. Still not sandboxed — write_file can still clobber files —
//   but the attack surface is a fraction of what execSync(anyString) was.

// ── Structured result envelope ─────────────────────────────────────────────

export type ToolErrorType =
  | "validation_error"   // Zod rejected the args (covers #3)
  | "not_found"          // path/file missing
  | "permission_denied"  // fs EACCES, etc.
  | "timeout"            // subprocess exceeded wall clock
  | "execution_error"    // anything else thrown
  | "unknown_tool";      // name wasn't in the registry

export interface ToolError {
  type: ToolErrorType;
  message: string;
  details?: unknown;
}

export type ToolResult =
  | { ok: true; data: string }
  | { ok: false; error: ToolError };

// ── Tool definition (internal, typed) ──────────────────────────────────────

interface Tool<T = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<T>;
  execute: (input: T) => Promise<string>;
}

// ── Individual tools ───────────────────────────────────────────────────────
//
// Each tool's schema lives next to its code. Adding a tool means adding
// one object to the `tools` array below — no switch statements to update.

const readFile: Tool<{ path: string }> = {
  name: "read_file",
  description: "Read the contents of a file at the given path.",
  inputSchema: z.object({
    path: z.string().min(1).describe("Absolute or relative file path"),
  }),
  async execute({ path: p }) {
    const content = fs.readFileSync(path.resolve(p), "utf-8");
    // Truncate: we don't want a 10 MB log file to blow the context window.
    return content.length > 50_000
      ? content.slice(0, 50_000) + "\n... [truncated]"
      : content;
  },
};

const writeFile: Tool<{ path: string; content: string }> = {
  name: "write_file",
  description: "Write content to a file. Creates or overwrites the file.",
  inputSchema: z.object({
    path: z.string().min(1).describe("File path to write"),
    content: z.string().describe("Content to write"),
  }),
  async execute({ path: p, content }) {
    const filePath = path.resolve(p);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
    return `Wrote ${filePath}`;
  },
};

const listDirectory: Tool<{ path?: string }> = {
  name: "list_directory",
  description: "List files and directories at the given path.",
  inputSchema: z.object({
    path: z.string().optional().describe("Directory path (defaults to cwd)"),
  }),
  async execute({ path: p }) {
    const dirPath = p && p.length > 0 ? p : ".";
    const entries = fs.readdirSync(path.resolve(dirPath), { withFileTypes: true });
    return (
      entries.map((e) => `${e.isDirectory() ? "d" : "f"}  ${e.name}`).join("\n") ||
      "(empty)"
    );
  },
};

// Replacement for the deleted run_command. Narrow, arg-validated, uses
// execFile (NOT execSync) so the query is never interpreted by a shell —
// closing the injection vector where a crafted query spawns arbitrary
// commands via $(...), `...`, or shell redirection.
const searchText: Tool<{ query: string; path?: string }> = {
  name: "search_text",
  description:
    "Search for a literal text pattern inside files under the given path. " +
    "Use this instead of running shell commands like `grep`.",
  inputSchema: z.object({
    query: z.string().min(1).describe("Literal text to search for"),
    path: z.string().optional().describe("Directory or file to search in (defaults to cwd)"),
  }),
  async execute({ query, path: p }) {
    const target = p && p.length > 0 ? p : ".";
    try {
      const out = execFileSync("grep", ["-rIn", "--", query, target], {
        encoding: "utf-8",
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      return out || "(no matches)";
    } catch (err: any) {
      // grep exits 1 when nothing matched — that's not an execution error.
      if (err && err.status === 1) return "(no matches)";
      throw err;
    }
  },
};

// The registry. Order matters only for display purposes.
const TOOL_REGISTRY: Tool<any>[] = [readFile, writeFile, listDirectory, searchText];

// ── What the LLM sees ──────────────────────────────────────────────────────
//
// Derive the JSON-Schema `parameters` field from the Zod schema. This is
// the single source of truth — if we ever change a tool's inputs, both
// the validator and the LLM-visible schema update together.

export const tools: ToolDef[] = TOOL_REGISTRY.map((t) => ({
  name: t.name,
  description: t.description,
  // Zod v4 ships first-party JSON-Schema conversion — single source of
  // truth: the same ZodType we validate with becomes the schema the LLM
  // sees. target: "openai" strips features OpenAI doesn't support.
  parameters: z.toJSONSchema(t.inputSchema, { target: "draft-7" }) as ToolDef["parameters"],
}));

// Lookup table for fast name → tool resolution during execution.
const TOOLS_BY_NAME = new Map(TOOL_REGISTRY.map((t) => [t.name, t]));

// ── Tool execution ─────────────────────────────────────────────────────────
//
// Boundary rules:
//   1. Resolve by name — unknown tools return a typed error, never throw.
//   2. Validate args with Zod — invalid input returns validation_error.
//   3. Run execute() — classify thrown errors into typed categories.
//
// Nothing inside this function is allowed to throw to the caller. The
// agent loop assumes every tool call produces a ToolResult it can stuff
// into the conversation history.

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) {
    return {
      ok: false,
      error: {
        type: "unknown_tool",
        message: `Unknown tool: ${name}. Available: ${[...TOOLS_BY_NAME.keys()].join(", ")}`,
      },
    };
  }

  // Validate at the boundary. This is where #3 lives.
  const parsed = tool.inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        type: "validation_error",
        message: formatZodError(parsed.error),
        // details is machine-readable so the model (or a later layer)
        // can reason about which field was wrong.
        details: parsed.error.issues,
      },
    };
  }

  try {
    const data = await tool.execute(parsed.data);
    return { ok: true, data };
  } catch (err: unknown) {
    return { ok: false, error: classifyError(err) };
  }
}

// Turn a ZodError into a single human-readable message the model can act on.
// Example: "path: Expected string, received number; content: Required"
function formatZodError(err: ZodError): string {
  return err.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

// Translate thrown runtime errors into our typed categories. The model
// reasons differently about "file doesn't exist" vs "we timed out".
function classifyError(err: unknown): ToolError {
  const e = err as NodeJS.ErrnoException | undefined;
  const message = e?.message ?? String(err);

  if (e?.code === "ENOENT") return { type: "not_found", message };
  if (e?.code === "EACCES" || e?.code === "EPERM") {
    return { type: "permission_denied", message };
  }
  if (e?.code === "ETIMEDOUT" || /timed out|timeout/i.test(message)) {
    return { type: "timeout", message };
  }
  return { type: "execution_error", message };
}
