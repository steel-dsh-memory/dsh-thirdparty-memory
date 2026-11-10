#!/usr/bin/env node
// Convert the Markdown docs to plain text (.txt) for platforms that dislike .md.
// Usage: node tools/md2txt.mjs docs/tutorial.md [more.md ...]
import { readFileSync, writeFileSync } from "node:fs";

const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(l) && l.includes("-");

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
      if (text === url) return text;
      const base = url.split(/[\\/]/).pop();
      if (!url.includes("://") && (text === base || url.endsWith("/" + text))) return text;
      return `${text} (${url})`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,:;]|$)/g, "$1$2")
    .replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,:;]|$)/g, "$1$2")
    .replace(/^(?:[-*+])\s+\[[ xX]\]\s+/gm, "- ")
    .replace(/\s+$/, "");
}

// Plain text has no room for a 200-column table: render wide tables as records.
function table(rows) {
  const raw = rows.filter((r) => !isTableSep(r));
  const grid = raw.map((r) =>
    r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => inline(c.trim())),
  );
  const header = grid[0] || [];
  const body = grid.slice(1);
  const hasHeader = header.some((c) => c.length > 0);
  const cols = Math.max(...grid.map((r) => r.length));

  const width = [];
  for (const row of grid) row.forEach((c, i) => (width[i] = Math.max(width[i] || 0, c.length)));
  const narrow = width.slice(0, cols).reduce((a, b) => a + (b || 0), 0) + 2 * (cols - 1) <= 100;

  if (narrow) {
    const lines = [];
    const pad = (row) => row.map((c, i) => (i === row.length - 1 ? c : c.padEnd(width[i] || 0))).join("  ").replace(/\s+$/, "");
    if (hasHeader) {
      lines.push(pad(header), "-".repeat(Math.min(100, pad(header).length)));
    }
    for (const row of body) lines.push(pad(row));
    return lines;
  }

  const out = [];
  for (const row of body) {
    const lead = row[0] || "";
    out.push("* " + lead);
    for (let i = 1; i < row.length; i++) {
      const cell = row[i] || "";
      if (!cell) continue;
      const label = header[i] || "";
      out.push("    " + (label ? label + ": " : "") + cell);
    }
    out.push("");
  }
  if (out[out.length - 1] === "") out.pop();
  return out;
}

function convert(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let fence = null;
  let buf = [];

  const flush = () => {
    if (buf.length) {
      out.push(...buf);
      buf = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\t/g, "    ");

    const f = line.match(/^\s*```(\w*)/);
    if (f) {
      if (fence === null) {
        flush();
        fence = f[1] || "";
        const lead = out.length ? [""] : [];
        out.push(...lead);
      } else {
        fence = null;
        out.push("");
      }
      continue;
    }
    if (fence !== null) {
      out.push("    " + line.replace(/\s+$/, ""));
      continue;
    }

    if (isTableRow(line)) {
      flush();
      const block = [];
      let j = i;
      while (j < lines.length && isTableRow(lines[j])) block.push(lines[j++]);
      out.push(...table(block), "");
      i = j - 1;
      continue;
    }

    if (!line.trim()) {
      flush();
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      const text = inline(h[2]);
      const level = h[1].length;
      if (out.length && out[out.length - 1] !== "") out.push("");
      if (level <= 2) {
        out.push(text, (level === 1 ? "=" : "-").repeat(Math.min(text.length, 72)), "");
      } else {
        out.push(text, "");
      }
      continue;
    }

    let m;
    if ((m = line.match(/^\s*>\s?(.*)$/))) {
      buf.push("  > " + inline(m[1]));
      continue;
    }
    if ((m = line.match(/^\s*([-*+])\s+(.*)$/))) {
      const indent = raw.match(/^\s*/)[0].length;
      buf.push(" ".repeat(indent) + "- " + inline(m[2]));
      continue;
    }
    if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) {
      const indent = raw.match(/^\s*/)[0].length;
      buf.push(" ".repeat(indent) + m[1] + ". " + inline(m[2]));
      continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flush();
      out.push("-".repeat(72), "");
      continue;
    }
    buf.push(inline(line));
  }
  flush();

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node tools/md2txt.mjs <file.md> [...]");
  process.exit(2);
}
for (const file of files) {
  const md = readFileSync(file, "utf8");
  const txt = convert(md);
  const target = file.replace(/\.md$/i, ".txt");
  writeFileSync(target, txt, "utf8");
  console.log(`${file} -> ${target} (${Buffer.byteLength(txt, "utf8")} bytes)`);
}
