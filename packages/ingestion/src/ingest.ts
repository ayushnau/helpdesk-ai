import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { parseMarkdownFile } from "./parsers/markdown.js";
import type { DocChunk } from "./types.js";

// --- Configuration ---
const HOME = process.env.HOME || process.env.USERPROFILE || "";
const DOCS_ROOT = join(HOME, "Personal/Posthog/docs");
const OUTPUT_PATH = join(import.meta.dirname, "../../..", "data/chunks.json");
const TENANT_ID = "posthog";

// Only ingest published/ directory (user-facing docs + handbook)
const INCLUDE_DIRS = ["published"];
const INCLUDE_EXTENSIONS = new Set([".md", ".mdx"]);

async function main() {
  console.log(`Scanning docs at: ${DOCS_ROOT}`);
  console.log(`Output: ${OUTPUT_PATH}\n`);

  const files = await collectFiles(DOCS_ROOT, INCLUDE_DIRS);
  console.log(`Found ${files.length} markdown files to process\n`);

  const allChunks: DocChunk[] = [];
  let skipped = 0;

  for (const filePath of files) {
    const relativePath = relative(DOCS_ROOT, filePath);
    const rawText = await readFile(filePath, "utf-8");

    try {
      const chunks = parseMarkdownFile(rawText, relativePath, TENANT_ID);
      allChunks.push(...chunks);
      console.log(`  ${relativePath} -> ${chunks.length} chunks`);
    } catch (err) {
      console.error(`  SKIP ${relativePath}: ${err instanceof Error ? err.message : err}`);
      skipped++;
    }
  }

  // Write output
  const outputDir = join(OUTPUT_PATH, "..");
  await mkdir(outputDir, { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(allChunks, null, 2), "utf-8");

  // Summary
  console.log("\n--- Summary ---");
  console.log(`Files processed: ${files.length - skipped}`);
  console.log(`Files skipped:   ${skipped}`);
  console.log(`Total chunks:    ${allChunks.length}`);
  console.log(`Output written:  ${OUTPUT_PATH}`);

  // Quick stats on chunk sizes
  const lengths = allChunks.map((c) => c.content.length);
  const avg = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
  const min = Math.min(...lengths);
  const max = Math.max(...lengths);
  console.log(`\nChunk sizes (chars): min=${min}, avg=${avg}, max=${max}`);
}

/**
 * Recursively collect all .md/.mdx files under the allowed directories.
 */
async function collectFiles(
  root: string,
  includeDirs: string[]
): Promise<string[]> {
  const results: string[] = [];

  for (const dir of includeDirs) {
    const dirPath = join(root, dir);
    await walkDir(dirPath, results);
  }

  return results.sort(); // deterministic order
}

async function walkDir(dir: string, results: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    console.error(`Directory ${dir} does not exist`);
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Skip _snippets directories — these are partial includes, not standalone docs
      if (entry.name.startsWith("_")) continue;
      await walkDir(fullPath, results);
    } else if (entry.isFile() && INCLUDE_EXTENSIONS.has(extname(entry.name))) {
      results.push(fullPath);
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
