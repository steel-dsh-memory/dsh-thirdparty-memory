/**
 * 用例 6：JSON→SQLite 首次迁移。
 * 6a：原 JSON 字节不变、生成 .bak_pre_sqlite_*、生成 .migrated 哨兵、SQLite 含全部条目；
 *     迁移后再 loadStore 不会重复迁移。
 * 6b（对抗）：JSON 里有重复 id 时 INSERT 会失败——检查失败后会不会留下一个"空库"，
 *     导致下一次 loadStore 显示 0 条且没有降级提示。
 */
import { join } from "node:path"
import { readdirSync, writeFileSync } from "node:fs"
import { loadStore, saveStore } from "../../core.js"
import { Audit, exists, entryCount, metaValue, sha256, workDir } from "./helpers.mjs"

const audit = new Audit("t06", "JSON→SQLite 首次迁移")

const dir = workDir("t06-migration")
const jsonFile = join(dir, "memory.json")
const dbFile = join(dir, "memory.sqlite")
const payload = {
  version: 2,
  settings: { maxRelevant: 5, injectMode: "auto" },
  entries: [
    { id: "m1", content: "[全局] 老前缀内容", category: "", tags: [] },
    { id: "m2", content: "置顶的规则", pinned: true },
    { id: "m3", content: "画像条目：他喜欢深色主题", tags: "画像,偏好" },
    { id: "m4", content: "项目记忆：alpha 部署", category: "project", project: "alpha" },
    { id: "m5", content: "临时记忆", category: "ephemeral", sessionId: "s-1" },
    { id: "m6", content: "归档条目", status: "archived" },
    { id: "m7", content: "普通条目 with english", category: "general", priority: "high" },
  ],
}
writeFileSync(jsonFile, JSON.stringify(payload, null, 2), "utf8")
const hash0 = sha256(jsonFile)
const bakList = () => readdirSync(dir).filter((name) => name.startsWith("memory.json.bak_pre_sqlite_")).sort()

const store = loadStore(jsonFile)
audit.eq("迁移后条目数", store.entries.length, 7)
audit.eq("迁移后 revision（首次写入应为 1）", store.revision, 1)
audit.check("原 JSON 字节不变", sha256(jsonFile) === hash0, `sha256 ${hash0.slice(0, 12)}…`)
audit.eq("生成 1 个 .bak_pre_sqlite_*", bakList().length, 1)
audit.check("备份内容与原 JSON 字节相同", sha256(join(dir, bakList()[0])) === hash0)
audit.check("生成 .migrated 哨兵", exists(`${dbFile}.migrated`))
audit.eq("SQLite 实际条目数", entryCount(dbFile), 7)
audit.eq("meta.migrated_from", metaValue(dbFile, "migrated_from"), jsonFile)
audit.check("meta.migrated_at 有值", Boolean(metaValue(dbFile, "migrated_at")))
audit.check("legacy [全局] 前缀被剥离且分类为 global", store.entries.find((entry) => entry.id === "m1")?.content === "老前缀内容" && store.entries.find((entry) => entry.id === "m1")?.category === "global", JSON.stringify(store.entries.find((entry) => entry.id === "m1")))
audit.eq("pinned → global", store.entries.find((entry) => entry.id === "m2")?.category, "global")
audit.eq("tags 画像 → persona", store.entries.find((entry) => entry.id === "m3")?.category, "persona")
audit.eq("settings 迁移", store.settings.maxRelevant, 5)

const store2 = loadStore(jsonFile)
audit.eq("二次 loadStore 条目数", store2.entries.length, 7)
audit.eq("二次 loadStore 未重复迁移（.bak 仍 1 个）", bakList().length, 1)
audit.eq("二次 loadStore revision 不变", store2.revision, store.revision)
audit.eq("二次 loadStore 时 SQLite 条目数", entryCount(dbFile), 7)

// ── 6b：JSON 含重复 id，迁移中途失败 ────────────────────────────────────────
const dir2 = workDir("t06b-duplicate-ids")
const json2 = join(dir2, "memory.json")
const db2 = join(dir2, "memory.sqlite")
writeFileSync(
  json2,
  JSON.stringify({
    version: 2,
    entries: [
      { id: "dup", content: "重复 id 的第一条" },
      { id: "dup", content: "重复 id 的第二条" },
      { id: "ok1", content: "正常条目" },
    ],
  }),
  "utf8",
)
const json2Hash = sha256(json2)
const first = loadStore(json2)
audit.check("6b 首次 loadStore 带 degraded（迁移失败被捕获）", Boolean(first.degraded), JSON.stringify(first.degraded))
audit.eq("6b 首次降级快照仍是 JSON 的 3 条", first.entries.length, 3)
audit.check("6b JSON 原文件未被改", sha256(json2) === json2Hash)
const second = loadStore(json2)
audit.check("[P1 可疑点] 6b 第二次 loadStore 仍有 degraded", Boolean(second.degraded), `degraded=${JSON.stringify(second.degraded)}`)
audit.eq("[P1 可疑点] 6b 第二次 loadStore 条目数（应为 3）", second.entries.length, 3)
// 迁移失败时会删掉刚建出来的半成品库（否则它会冒充「正常的空库」顶掉 degraded），
// 所以这里按「文件不存在 = 0 条」处理，不能再无条件 entryCount。
audit.eq("6b 迁移失败后 SQLite 里实际条目数", exists(db2) ? entryCount(db2) : 0, 0)
audit.check("6b 迁移失败没有写 .migrated 哨兵", !exists(`${db2}.migrated`))
let writeError = null
try {
  saveStore(json2, second)
} catch (error) {
  writeError = error
}
audit.check("[P1 可疑点] 6b 空库写入是否被拒", writeError !== null, `writeError=${String(writeError?.code ?? "没有抛错")}`)

audit.finish()
