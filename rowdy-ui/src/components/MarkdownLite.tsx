/**
 * A tiny, dependency-free Markdown renderer for AI answers (the Rules Official).
 *
 * Handles the small subset the model is prompted to emit: headings, bullet and
 * numbered lists, blockquotes, and inline **bold** / *italic* / `code`. It does
 * NOT render tables or raw HTML (the system prompt tells the model to avoid
 * tables). Output is built as React nodes — never dangerouslySetInnerHTML — so
 * model text can't inject markup.
 */

import { type ReactNode } from "react";

/** Parse inline **bold**, *italic*, and `code` spans into React nodes. */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-i${i++}`;
    if (tok.startsWith("**")) {
      nodes.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 text-[0.85em] font-mono">
          {tok.slice(1, -1)}
        </code>
      );
    } else {
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "p"; text: string };

/** Group raw lines into block-level elements. */
function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "p", text: para.join(" ") });
      para = [];
    }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushPara();
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }

    if (/^([-*])\s+/.test(trimmed)) {
      flushPara();
      const items: string[] = [];
      while (idx < lines.length && /^([-*])\s+/.test(lines[idx].trim())) {
        items.push(lines[idx].trim().replace(/^([-*])\s+/, ""));
        idx++;
      }
      idx--;
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\d+[.)]\s+/.test(trimmed)) {
      flushPara();
      const items: string[] = [];
      while (idx < lines.length && /^\d+[.)]\s+/.test(lines[idx].trim())) {
        items.push(lines[idx].trim().replace(/^\d+[.)]\s+/, ""));
        idx++;
      }
      idx--;
      blocks.push({ type: "ol", items });
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushPara();
      blocks.push({ type: "quote", text: trimmed.replace(/^>\s?/, "") });
      continue;
    }

    para.push(trimmed);
  }
  flushPara();
  return blocks;
}

export default function MarkdownLite({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={className}>
      {blocks.map((block, bi) => {
        const key = `b${bi}`;
        switch (block.type) {
          case "heading": {
            const size = block.level <= 1 ? "text-lg" : block.level === 2 ? "text-base" : "text-sm";
            return (
              <p key={key} className={`${size} font-bold mt-3 first:mt-0`}>
                {renderInline(block.text, key)}
              </p>
            );
          }
          case "ul":
            return (
              <ul key={key} className="list-disc pl-5 my-2 space-y-1">
                {block.items.map((it, ii) => (
                  <li key={`${key}-${ii}`}>{renderInline(it, `${key}-${ii}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key} className="list-decimal pl-5 my-2 space-y-1">
                {block.items.map((it, ii) => (
                  <li key={`${key}-${ii}`}>{renderInline(it, `${key}-${ii}`)}</li>
                ))}
              </ol>
            );
          case "quote":
            return (
              <blockquote key={key} className="border-l-2 border-border pl-3 my-2 text-muted-foreground italic">
                {renderInline(block.text, key)}
              </blockquote>
            );
          default:
            return (
              <p key={key} className="my-2 first:mt-0 last:mb-0 leading-relaxed">
                {renderInline(block.text, key)}
              </p>
            );
        }
      })}
    </div>
  );
}
