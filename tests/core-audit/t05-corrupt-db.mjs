/**
 * 用例 5：库文件是垃圾字节（"not a database"）。
 * 期望：loadStore 返回 degraded、不覆盖垃圾字节、写入被拒。
 * 5b 额外：sourceFile 是 JSON 且 SQLite 损坏时，降级快照应来自 JSON 且仍然禁写。
 */
import { join } from "node:path"
import { writeFileSync } from "node:fs"
import { loadStore, mutateStore, normalizeEntry, renderInjection, saveStore } from "../../core.js"
import { Audit, exists, sha256, sizeOf, workDir } from "./helpers.mjs"

const audit = new Audit("t05", "损坏库文件降级")

const junk = Buffer.from("not a database 这不是数据库 🎉\u0000", "utf8")
const dir = workDir("t05-corrupt")
const file = join(dir, "memory.sqlite")
writeFileSync(file, junk)
const hash0 = sha256(file)
const size0 = sizeOf(file)

const store = loadStore(file)
audit.check("loadStore 返回 degraded", Boolean(store.degraded), JSON.stringify(store.degraded))
audit.check("degraded.reason 说明 SQLite 读取失败", /SQLite/.test(String(store.degraded?.reason ?? "")), String(store.degraded?.reason ?? ""))
audit.eq("降级后条目为空", store.entries.length, 0)
audit.check("垃圾字节未被覆盖（sha256 相同）", sha256(file) === hash0, `size ${size0} → ${sizeOf(file)}`)
audit.check("没有创建 -wal", !exists(`${file}-wal`))
audit.check("没有创建 -shm", !exists(`${file}-shm`))
audit.check("没有创建 .migrated 哨兵", !exists(`${file}.migrated`))

let saveError = null
try {
  saveStore(file, store)
} catch (error) {
  saveError = error
}
audit.check("损坏库 saveStore 抛 MEMORY_DEGRADED", saveError?.code === "MEMORY_DEGRADED", String(saveError?.message ?? "没有抛错"))
audit.check("被拒后字节仍未变", sha256(file) === hash0)

const rendered = renderInjection(store, { query: "", config: {} })
audit.check("损坏库注入段含『记忆库异常』警告", rendered.text.includes("记忆库异常"), rendered.text.slice(0, 120))

// 5b：DATA_FILE 配成 .json（sourceFile）而 .sqlite 损坏 → 降级快照回落到 JSON 内容
const dir2 = workDir("t05b-corrupt-with-json")
const jsonFile = join(dir2, "memory.json")
const dbFile = join(dir2, "memory.sqlite")
writeFileSync(
  jsonFile,
  JSON.stringify({ version: 2, entries: [{ id: "j1", content: "JSON 里的旧数据", category: "global" }] }, null, 2),
  "utf8",
)
writeFileSync(dbFile, junk)
const dbHash = sha256(dbFile)
const store2 = loadStore(jsonFile)
audit.check("JSON 源 + 损坏库：degraded", Boolean(store2.degraded), JSON.stringify(store2.degraded))
audit.eq("降级快照取 JSON 内容", store2.entries.length, 1)
let saveError2 = null
try {
  saveStore(jsonFile, store2)
} catch (error) {
  saveError2 = error
}
audit.check("JSON 源降级写入被拒", saveError2?.code === "MEMORY_DEGRADED", String(saveError2?.message ?? "没有抛错"))
audit.check("损坏的 .sqlite 未被覆盖", sha256(dbFile) === dbHash)
let mutateError2 = null
try {
  mutateStore(jsonFile, (next) => next.entries.push(normalizeEntry({ id: "x", content: "不该写" })))
} catch (error) {
  mutateError2 = error
}
audit.check("JSON 源降级 mutateStore 被拒", mutateError2?.code === "MEMORY_DEGRADED", String(mutateError2?.message ?? "没有抛错"))

audit.finish()
