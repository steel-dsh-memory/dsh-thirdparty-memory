/**
 * P2 regression for the fixes that affect data isolation / retrieval semantics.
 * Not part of core-audit (kept at its 0.4.6 gate); run manually:
 *   node tests/p2-regression.mjs
 */
import assert from "node:assert/strict"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { normalizeEntry, renderInjection } from "../core.js"

const entries = [
  { id: "g1", content: "全局规则", category: "global" },
  { id: "p1", content: "项目记忆A", category: "project", project: "proj" },
  { id: "x1", content: "普通记忆B", category: "general" },
  { id: "e1", content: "本会话临时", category: "ephemeral", sessionId: "S1" },
  { id: "e2", content: "别的会话临时", category: "ephemeral", sessionId: "S2" },
]
const store = { entries: entries.map((entry) => normalizeEntry(entry)), settings: {} }
const base = { maxBytes: 8192, maxRelevant: 50, maxEntries: 50 }

// 1. all mode must not silently fall back to keyword/project gates.
{
  const out = renderInjection(store, {
    query: "",
    sessionId: "S1",
    config: { ...base, injectMode: "all", showIndex: false },
    all: true,
  })
  assert.equal(out.selected.all, true)
  assert.match(out.text, /全局规则/)
  assert.match(out.text, /项目记忆A/)
  assert.match(out.text, /普通记忆B/)
  assert.match(out.text, /本会话临时/)
  assert.doesNotMatch(out.text, /别的会话临时/)
  assert.equal(out.selected.rest.length, 0)
}

// 2. relevant mode must not surface another session's ephemeral in index or recall.
{
  const out = renderInjection(store, {
    query: "hello",
    sessionId: "S1",
    config: { ...base, injectMode: "relevant", showIndex: true },
  })
  assert.match(out.text, /本会话临时/)
  assert.doesNotMatch(out.text, /别的会话临时/)

  const recall = renderInjection(store, {
    query: "提取关于别的会话临时的全部记忆",
    sessionId: "S1",
    config: { ...base, injectMode: "relevant", showIndex: true },
  })
  assert.ok(recall.selected.recall)
  assert.doesNotMatch(recall.text, /别的会话临时/)
}

// 3. vector numbers must survive the Standard Schema validator as decimals.
{
  const root = mkdtempSync(join(tmpdir(), "dsh-p2-config-"))
  try {
    copyFileSync(new URL("../index.js", import.meta.url), join(root, "index.js"))
    copyFileSync(new URL("../core.js", import.meta.url), join(root, "core.js"))
    const dep = join(root, "node_modules", "@deepseek-ai", "dsh-tools")
    mkdirSync(dep, { recursive: true })
    writeFileSync(join(dep, "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh-tools", type: "module", exports: "./index.js" }))
    writeFileSync(join(dep, "index.js"), "export function defineTool(value) { return value }\n")
    const mod = await import(pathToFileURL(join(root, "index.js")).href)
    const config = mod.Config({ vectorWeight: 0.5, vectorMinCos: 0.3 })
    assert.equal(config.vectorWeight, 0.5)
    assert.equal(config.vectorMinCos, 0.3)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

console.log("P2 regression: all checks passed")
