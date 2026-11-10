/**
 * core-audit 共享工具：临时目录、SQLite 取证读取、断言与结果落盘。
 * 只操作 tests/core-audit/tmp 下的临时库，绝不碰 F:\dsh-memory-data。
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
export const { DatabaseSync } = require("node:sqlite")

export const HERE = dirname(fileURLToPath(import.meta.url))
export const TMP_ROOT = join(HERE, "tmp")
export const RESULTS_DIR = join(HERE, "results")

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 每个用例一个干净子目录；目录名固定，便于复现。 */
export function workDir(name) {
  const dir = join(TMP_ROOT, name)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

export function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

export function exists(file) {
  return existsSync(file)
}

export function sizeOf(file) {
  try {
    return statSync(file).size
  } catch {
    return -1
  }
}

export function listSqliteBackups(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.startsWith("memory-") && name.endsWith(".sqlite"))
    .sort()
}

export function entryCount(dbFile) {
  const db = new DatabaseSync(dbFile)
  try {
    return Number(db.prepare("SELECT COUNT(*) AS n FROM entries").get().n)
  } finally {
    db.close()
  }
}

export function metaValue(dbFile, key) {
  const db = new DatabaseSync(dbFile)
  try {
    const row = db.prepare("SELECT v FROM meta WHERE k = ?").get(key)
    return row ? String(row.v) : null
  } finally {
    db.close()
  }
}

export function rowsOf(dbFile, sql, params = []) {
  const db = new DatabaseSync(dbFile)
  try {
    return db.prepare(sql).all(...params)
  } finally {
    db.close()
  }
}

/** 断言收集器：PASS/FAIL 打到 stdout，同时写 results/<id>.json 供汇总。 */
export class Audit {
  constructor(id, title) {
    this.id = id
    this.title = title
    this.checks = []
    this.t0 = performance.now()
    mkdirSync(RESULTS_DIR, { recursive: true })
  }

  check(name, ok, detail = "") {
    const item = { name, ok: ok === true, detail: String(detail ?? "") }
    this.checks.push(item)
    console.log(`${item.ok ? "PASS" : "FAIL"}  ${name}${item.detail ? "  :: " + item.detail : ""}`)
    return item
  }

  eq(name, actual, expected, extra = "") {
    return this.check(
      name,
      JSON.stringify(actual) === JSON.stringify(expected),
      `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}${extra ? " " + extra : ""}`,
    )
  }

  finish() {
    const ms = Math.round(performance.now() - this.t0)
    const failed = this.checks.filter((item) => !item.ok).length
    const payload = {
      id: this.id,
      title: this.title,
      at: new Date().toISOString(),
      ms,
      passed: this.checks.length - failed,
      failed,
      checks: this.checks,
    }
    writeFileSync(join(RESULTS_DIR, `${this.id}.json`), JSON.stringify(payload, null, 2), "utf8")
    console.log(`RESULT ${this.id} passed=${payload.passed} failed=${failed} ms=${ms}`)
    process.exitCode = failed > 0 ? 1 : 0
    return payload
  }
}
