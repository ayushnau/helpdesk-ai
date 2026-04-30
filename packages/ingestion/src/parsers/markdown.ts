import matter from "gray-matter";
import { createHash } from "node:crypto";
import type { DocChunk } from "../types.js";

// nomic-embed-text has 8192 token context; ~4 chars/token = ~32k chars max.
// We use a conservative limit to leave room for tokenizer variance.
const MAX_CHUNK_CHARS = 4000;

/**
 * Heading found in markdown content.
 * `level` is 1-6 corresponding to # through ######.
 * `text` is the heading text without the # prefix.
 * `content` is everything between this heading and the next heading (or EOF).
 */
interface Section {
  level: number;
  text: string;
  content: string;
}

/**
 * Parse a single markdown/mdx file into chunks.
 *
 * Strategy: split at heading boundaries. Each heading starts a new chunk.
 * Content before the first heading (if any) becomes a chunk titled with the doc title.
 */
export function parseMarkdownFile(
  rawText: string,
  relativePath: string, // e.g. "published/docs/cdp/sources/stripe.md"
  tenantId: string
): DocChunk[] {
  // Step 1: separate YAML frontmatter from content
  const { data: frontmatter, content } = matter(rawText);
  const docTitle = (frontmatter.title as string) || titleFromPath(relativePath);
  const docType = deriveDocType(relativePath);

  // Step 2: split content into sections at heading boundaries
  const rawSections = splitAtHeadings(content);

  // Step 2.5: break any oversized sections into smaller pieces
  const sections = splitOversizedSections(rawSections, MAX_CHUNK_CHARS);

  // Step 3: build chunks with section path context
  const chunks: DocChunk[] = [];

  // Track the current heading hierarchy to build section_path.
  // Index 0 = h1, index 1 = h2, etc. When we see an h2, we clear h3-h6.
  const headingStack: string[] = [];

  for (const section of sections) {
    const trimmed = section.content.trim();
    if (trimmed.length === 0) continue; // skip empty sections

    if (section.level === 0) {
      // Content before any heading — use doc title as the section path
      chunks.push(
        makeChunk(trimmed, docTitle, relativePath, docTitle, docType, tenantId)
      );
    } else {
      // Update heading stack: set this level, clear everything deeper.
      // level 1 = index 0, level 2 = index 1, etc.
      headingStack[section.level - 1] = section.text;
      headingStack.length = section.level; // truncate deeper levels

      // Build section path from doc title + heading hierarchy.
      // Filter out empty/undefined entries (e.g., h2 appears without a prior h1)
      const sectionPath = [docTitle, ...headingStack]
        .filter(Boolean)
        .join(" > ");

      chunks.push(
        makeChunk(trimmed, sectionPath, relativePath, docTitle, docType, tenantId)
      );
    }
  }

  return chunks;
}

/**
 * Split markdown content into sections at heading boundaries.
 * Returns an array where each entry is a heading + the content below it.
 * Content before the first heading gets level=0.
 */
function splitAtHeadings(content: string): Section[] {
  const sections: Section[] = [];

  // First, find all fenced code block ranges so we can skip headings inside them.
  // A code fence is a line starting with ``` (with optional language tag).
  const codeRanges = findCodeBlockRanges(content);

  // Match lines that start with 1-6 # characters followed by a space.
  const headingRegex = /^(#{1,6})\s+(.+)$/gm;

  let lastIndex = 0;
  let lastHeading: { level: number; text: string } | null = null;
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(content)) !== null) {
    // Skip headings that fall inside a fenced code block
    if (isInsideCodeBlock(match.index, codeRanges)) continue;

    const sectionContent = content.slice(lastIndex, match.index);

    if (lastHeading === null) {
      if (sectionContent.trim().length > 0) {
        sections.push({ level: 0, text: "", content: sectionContent });
      }
    } else {
      sections.push({
        level: lastHeading.level,
        text: lastHeading.text,
        content: sectionContent,
      });
    }

    lastHeading = {
      level: match[1].length,
      text: match[2].trim(),
    };
    lastIndex = match.index + match[0].length;
  }

  // Don't forget the last section (from last heading to EOF)
  const remaining = content.slice(lastIndex);
  if (lastHeading) {
    sections.push({
      level: lastHeading.level,
      text: lastHeading.text,
      content: remaining,
    });
  } else if (remaining.trim().length > 0) {
    // Entire file has no headings — treat as one chunk
    sections.push({ level: 0, text: "", content: remaining });
  }

  return sections;
}

/**
 * Accumulate lines into chunks, flushing when the buffer would exceed maxChars.
 * Tries paragraph boundaries (\n\n) first; falls back to line boundaries (\n)
 * for content that's one giant paragraph (tables, code blocks, bullet lists).
 */
function splitContentByBoundary(content: string, maxChars: number): string[] {
  // Try paragraph split first
  const paragraphs = content.split(/\n\n+/);
  const result = accumulateChunks(paragraphs, "\n\n", maxChars);

  // If any chunk is still oversized, split those on single newlines
  const final: string[] = [];
  for (const chunk of result) {
    if (chunk.length <= maxChars) {
      final.push(chunk);
    } else {
      const lines = chunk.split("\n");
      final.push(...accumulateChunks(lines, "\n", maxChars));
    }
  }

  return final;
}

/** Generic accumulator: join pieces with separator, flush when buffer exceeds maxChars */
function accumulateChunks(
  pieces: string[],
  separator: string,
  maxChars: number
): string[] {
  const result: string[] = [];
  let buffer = "";

  for (const piece of pieces) {
    const wouldBe = buffer.length === 0 ? piece : buffer + separator + piece;

    if (wouldBe.length > maxChars && buffer.length > 0) {
      result.push(buffer);
      buffer = piece;
    } else {
      buffer = wouldBe;
    }
  }

  if (buffer.length > 0) {
    result.push(buffer);
  }

  return result;
}

/**
 * Split sections that exceed maxChars into smaller pieces at paragraph boundaries.
 * Preserves heading metadata — sub-chunks share the same level and text.
 */
function splitOversizedSections(
  sections: Section[],
  maxChars: number
): Section[] {
  const result: Section[] = [];

  for (const section of sections) {
    if (section.content.length <= maxChars) {
      result.push(section);
      continue;
    }

    // Split on double-newline (paragraph boundary), then fall back to
    // single-newline for oversized single-paragraph content (tables, lists, code blocks)
    const subChunks = splitContentByBoundary(section.content, maxChars);
    for (const chunk of subChunks) {
      result.push({ level: section.level, text: section.text, content: chunk });
    }
  }

  return result;
}

/** Find [start, end] character ranges of fenced code blocks (``` ... ```) */
function findCodeBlockRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const fenceRegex = /^```/gm;
  let openIndex: number | null = null;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(content)) !== null) {
    if (openIndex === null) {
      openIndex = match.index;
    } else {
      ranges.push([openIndex, match.index + match[0].length]);
      openIndex = null;
    }
  }

  // Unclosed code block — extend to EOF
  if (openIndex !== null) {
    ranges.push([openIndex, content.length]);
  }

  return ranges;
}

function isInsideCodeBlock(
  index: number,
  ranges: Array<[number, number]>
): boolean {
  return ranges.some(([start, end]) => index >= start && index <= end);
}

/** Deterministic chunk ID from content + path so re-runs produce the same IDs */
function makeChunkId(content: string, sectionPath: string): string {
  return createHash("sha256")
    .update(sectionPath + "\n" + content)
    .digest("hex")
    .slice(0, 16); // 16 hex chars = 64 bits, enough to avoid collisions in <100k chunks
}

function makeChunk(
  content: string,
  sectionPath: string,
  sourceFile: string,
  docTitle: string,
  docType: "docs" | "handbook",
  tenantId: string
): DocChunk {
  return {
    id: makeChunkId(content, sectionPath),
    tenant_id: tenantId,
    source_file: sourceFile,
    doc_title: docTitle,
    section_path: sectionPath,
    content,
    doc_type: docType,
  };
}

/** Derive doc_type from the file path */
function deriveDocType(relativePath: string): "docs" | "handbook" {
  if (relativePath.includes("/handbook/")) return "handbook";
  return "docs";
}

/** Fallback title from file path when frontmatter has no title */
function titleFromPath(relativePath: string): string {
  const fileName = relativePath.split("/").pop() || relativePath;
  return fileName
    .replace(/\.(md|mdx)$/, "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
