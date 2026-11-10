/**
 * 用例 4：库缺失 + .migrated 哨兵存在。
 * 4a 期望：loadStore 返回 degraded、不创建空库、saveStore/mutateStore 抛 MEMORY_DEGRADED。
 * 4b 可疑点（重点实测）：先调 storageInfo() 再 loadStore()，看 storageInfo 是否偷偷建了
 *     空 memory.sqlite，把降级保护整个绕过。server.js:216 snapshot() 在每次页面加载时调
 *     storageInfo，所以这个顺序在真实流程里一定会出现。
 */
import { join } from "node:path"
import { mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { loadStore, mutateStore, normalizeEntry, renderInjection, saveStore, storageInfo } from "../../core.js"
import { Audit, entryCount, exists, sha256, workDir } from "./helpers.mjs"

const audit = new Audit("t04", "库缺失 + 哨兵：降级保护")

const dir = workDir("t04-missing-sentinel")
const file = join(dir, "memory.sqlite")
const sentinel = `${file}.migrated`
writeFileSync(sentinel, JSON.stringify({ migratedFrom: "memory.json", at: "2026-11-09T00:00:00.000Z", dbFile: file }), "utf8")

const store = loadStore(file)
audit.check("loadStore 返回 degraded", Boolean(store.degraded), JSON.stringify(store.degraded))
audit.eq("降级时条目为空", store.entries.length, 0)
audit.eq("降级时 revision=0", store.revision ?? 0, 0)
audit.check("loadStore 没有创建空 memory.sqlite", !exists(file))
audit.check("loadStore 没有创建 -wal", !exists(`${file}-wal`))
audit.check("loadStore 没有创建 -shm", !exists(`${file}-shm`))

let saveError = null
try {
  saveStore(file, store)
} catch (error) {
  saveError = error
}
audit.check("降级库 saveStore 抛 MEMORY_DEGRADED", saveError?.code === "MEMORY_DEGRADED", String(saveError?.message ?? "没有抛错"))
audit.check("被拒后依然没有库文件", !exists(file))

let mutateError = null
try {
  mutateStore(file, (next) => {
    next.entries.push(normalizeEntry({ id: "bad", content: "不该写进去" }))
  })
} catch (error) {
  mutateError = error
}
audit.check("降级库 mutateStore 抛 MEMORY_DEGRADED", mutateError?.code === "MEMORY_DEGRADED", String(mutateError?.message ?? "没有抛错"))
audit.check("被拒后依然没有库文件（2）", !exists(file))

const rendered = renderInjection(store, { query: "测试", config: {} })
audit.check("降级注入段含『记忆库异常』警告", rendered.text.includes("记忆库异常"), rendered.text.slice(0, 120))

// ── 真实页面顺序：loadStore（渲染）→ storageInfo（快照）→ 再次 loadStore ──
const info = storageInfo(file)
audit.check(
  "[P0 可疑点] storageInfo 不该创建空库，但实际：",
  !exists(file),
  `exists=${exists(file)} dbFile=${info?.dbFile ?? "?"}`,
)
const storeAfterInfo = loadStore(file)
audit.check(
  "[P0 可疑点] storageInfo 之后 loadStore 仍应 degraded",
  Boolean(storeAfterInfo.degraded),
  `degraded=${JSON.stringify(storeAfterInfo.degraded)} entries=${storeAfterInfo.entries.length} revision=${storeAfterInfo.revision}`,
)

let wrote = null
try {
  mutateStore(file, (next) => {
    next.entries.push(normalizeEntry({ id: "after-info", content: "库丢失后通过页面新写的一条" }))
  })
  wrote = "written"
} catch (error) {
  wrote = `${error?.code ?? "ERR"}: ${error?.message ?? error}`
}
audit.check(
  "[P0 可疑点] 库丢失后写入应仍被拒绝",
  wrote !== "written",
  `写入结果=${wrote}；写入后 SQLite 实际条数=${exists(file) ? entryCount(file) : "（库文件不存在，正确）"}`,
)
audit.check("memory.sqlite 不应被 storageInfo 创建", !exists(file), `exists=${exists(file)}`)

// 4b：storageInfo 先于任何 loadStore（例如先打开详情页再触发注入）
const dir2 = workDir("t04b-info-first")
const file2 = join(dir2, "memory.sqlite")
writeFileSync(`${file2}.migrated`, "{}", "utf8")
storageInfo(file2)
const createdByInfo = exists(file2)
audit.check("[P0 可疑点] 全新降级目录里 storageInfo 直接建库", !createdByInfo, `exists=${createdByInfo}`)
const store2 = loadStore(file2)
audit.check("[P0 可疑点] storageInfo 先行时 loadStore 的 degraded", Boolean(store2.degraded), JSON.stringify(store2.degraded))

// 4c：全新安装（库不存在、没有哨兵、但有旧 JSON 迁移源）。
// 期望：先 loadStore 会触发迁移；但若先 storageInfo 建了空库，迁移会被永久跳过。
const dir3 = workDir("t04c-json-migration-skipped")
const legacyJson = join(dir3, "data", "memory.json")
const dataFile = join(dir3, "memory.sqlite")
mkdirSync(join(dir3, "data"), { recursive: true })
writeFileSync(legacyJson, JSON.stringify({ version: 2, entries: [{ id: "old1", content: "插件目录里的旧记忆" }] }, null, 2), "utf8")
const jsonHash = sha256(legacyJson)
storageInfo(dataFile) // 页面/仪表盘先拿 storage
const skipped = loadStore(dataFile, { legacyFile: legacyJson })
audit.check("[P0 同源] 先 storageInfo 时旧 JSON 应被迁移（实际条目数）", skipped.entries.length === 1, `entries=${skipped.entries.length} degraded=${JSON.stringify(skipped.degraded)} dbExists=${exists(dataFile)}`)
const bakFiles = readdirSync(join(dir3, "data")).filter((name) => name.includes(".bak_pre_sqlite_"))
audit.check("[P0 同源] 迁移应已发生（应生成 .bak 文件）", bakFiles.length === 1, `bak=${JSON.stringify(bakFiles)}`)
audit.eq("[P0 同源] 旧 JSON 字节不变", sha256(legacyJson), jsonHash)
audit.eq("[P0 同源] 迁移后 SQLite 实际条数", exists(dataFile) ? entryCount(dataFile) : 0, 1)
audit.check("[P0 同源] 应生成 .migrated 哨兵", exists(`${dataFile}.migrated`), `exists=${exists(`${dataFile}.migrated`)}`)

// 对照组：同样的目录顺序反过来（loadStore 先行）应当正常迁移
const dir4 = workDir("t04d-json-migration-normal")
const legacyJson2 = join(dir4, "data", "memory.json")
const dataFile2 = join(dir4, "memory.sqlite")
mkdirSync(join(dir4, "data"), { recursive: true })
writeFileSync(legacyJson2, JSON.stringify({ version: 2, entries: [{ id: "old1", content: "插件目录里的旧记忆" }] }, null, 2), "utf8")
const migrated = loadStore(dataFile2, { legacyFile: legacyJson2 })
audit.eq("[对照] loadStore 先行时迁移正常（1 条）", migrated.entries.length, 1)

audit.finish()
