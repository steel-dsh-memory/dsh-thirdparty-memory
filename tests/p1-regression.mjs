/**
 * P1 regression: legacy JSON migration must never fall back to a silent empty store.
 * Not part of core-audit (which is kept at its 0.4.6 gate); run manually:
 *   node tests/p1-regression.mjs
 */
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadStore, saveStore } from "../core.js"

const entry = {
  id: "old-1",
  content: "旧记忆必须继续可见",
  category: "general",
  source: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

function legacyJson(file, payload) {
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, JSON.stringify(payload, null, 2), "utf8")
}

const root = mkdtempSync(join(tmpdir(), "dsh-p1-"))
try {
  // 1. Normal migration still works.
  {
    const dir = join(root, "normal")
    const legacy = join(dir, "memory.json")
    const target = join(dir, "memory.sqlite")
    legacyJson(legacy, { version: 2, entries: [entry] })
    const store = loadStore(target, { legacyFile: legacy })
    assert.equal(store.entries.length, 1)
    assert.equal(store.degraded, undefined)
    assert.ok(existsSync(target))
    assert.equal(store.entries[0].content, entry.content)
  }

  // 2. Corrupt legacy JSON: visible + degraded, not a silent empty store.
  {
    const dir = join(root, "corrupt")
    const legacy = join(dir, "memory.json")
    const target = join(dir, "memory.sqlite")
    mkdirSync(dir, { recursive: true })
    writeFileSync(legacy, "{ not valid json", "utf8")
    const store = loadStore(target, { legacyFile: legacy })
    assert.equal(store.entries.length, 0)
    assert.match(String(store.degraded?.reason ?? ""), /旧 JSON 迁移失败/)
    assert.equal(existsSync(target), false, "must not create an empty sqlite before the user resolves it")
    assert.throws(() => saveStore(target, { ...store, entries: [entry] }), /MEMORY_DEGRADED/)
  }

  // 3. Backup failure: old entries stay visible, writes refused, no empty db.
  if (process.platform !== "win32" && (process.getuid?.() ?? 1) !== 0) {
    const dir = join(root, "readonly")
    const legacy = join(dir, "memory.json")
    const target = join(dir, "memory.sqlite")
    legacyJson(legacy, { version: 2, entries: [entry] })
    chmodSync(dir, 0o555)
    try {
      const store = loadStore(target, { legacyFile: legacy })
      assert.equal(store.entries.length, 1)
      assert.equal(store.entries[0].content, entry.content)
      assert.match(String(store.degraded?.reason ?? ""), /backup-failed/)
      assert.equal(existsSync(target), false)
      assert.throws(() => saveStore(target, { ...store, entries: [entry] }), /MEMORY_DEGRADED/)
    } finally {
      chmodSync(dir, 0o755)
    }
  }
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log("P1 regression: all checks passed")
