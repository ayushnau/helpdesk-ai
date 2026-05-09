"use client";

import React from "react";
import { CiteRef } from "./ui";

export function renderRich(text: string): React.ReactNode[] {
  const blocks = text.split(/\n\n+/);
  return blocks.map((blk, bi) => {
    if (blk.startsWith("```")) {
      const lines = blk.split("\n");
      const lang = lines[0].slice(3).trim();
      const code = lines.slice(1, lines[lines.length - 1] === "```" ? -1 : undefined).join("\n");
      return (
        <pre className="code-block" key={bi}>
          {lang && <div className="code-lang mono">{lang}</div>}
          <code>{code}</code>
        </pre>
      );
    }
    if (/^\s*[-•]\s/.test(blk) || /^\d+\.\s/.test(blk)) {
      const items = blk.split("\n");
      const ordered = /^\d+\.\s/.test(items[0]);
      const Tag = ordered ? "ol" : "ul";
      return (
        <Tag key={bi} className="rich-list">
          {items.map((li, i) => (
            <li key={i}>{renderInline(li.replace(/^\s*([-•]|\d+\.)\s/, ""))}</li>
          ))}
        </Tag>
      );
    }
    return <p key={bi} className="rich-p">{renderInline(blk)}</p>;
  });
}

function renderInline(s: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let idx = 0;
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[\d+\])/g;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) out.push(<code key={idx++} className="code-inline">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("**")) out.push(<strong key={idx++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("[")) {
      const n = Number(tok.slice(1, -1));
      out.push(<CiteRef key={idx++} n={n} />);
    }
    last = m.index + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
