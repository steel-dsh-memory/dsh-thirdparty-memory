/** 用例 1：基础 CRUD —— add 100 条、读回顺序/内容、update 全字段、remove。 */
import { join } from "node:path"
import {
  expiresFrom,
  loadStore,
  mutateStore,
  normalizeEntry,
  nowIso,
  storageInfo,
} from "../../core.js"
import { Audit, entryCount, sizeOf, workDir } from "./helpers.mjs"

const dir = workDir("t01-crud")
const file = join(dir, "memory.sqlite")
const audit = new Audit("t01", "基础 CRUD")

const contentFor = (i) => `第 ${i} 条记忆：内容唯一值 unique-${String(i).padStart(3, "0")} — 中文/emoji 🎉`
const expected = []

for (let i = 1; i <= 100; i += 1) {
  const id = `c-${String(i).padStart(3, "0")}`
  expected.push({ id, content: contentFor(i) })
  mutateStore(file, (store) => {
    store.entries.push(
      normalizeEntry({
        id,
        content: contentFor(i),
        category: i % 5 === 0 ? "project" : i % 7 === 0 ? "persona" : "general",
        project: i % 5 === 0 ? `proj-${i % 3}` : "",
        priority: i % 3 === 0 ? "high" : i % 11 === 0 ? "low" : "medium",
        tags: i % 4 === 0 ? ["标签A", "标签B"] : [],
      }),
    )
  })
}

let store = loadStore(file)
audit.eq("add 100 条后条数", store.entries.length, 100)
audit.check(
  "顺序与内容完全一致",
  store.entries.every((entry, index) => entry.id === expected[index].id && entry.content === expected[index].content),
  store.entries
    .map((entry, index) => (entry.id === expected[index].id && entry.content === expected[index].content ? "" : `#${index + 1}`))
    .filter(Boolean)
    .join(",") || "全部一致",
)
audit.eq("add 后 revision", store.revision, 100)
audit.eq("后端必须是 sqlite 而不是静默退化的 json", storageInfo(file).backend, "sqlite")
audit.eq("sqliteAvailable", storageInfo(file).sqliteAvailable, true)

// ── update：内容 / 分类 / 优先级 / 状态 / 项目 / TTL ─────────────────────────
const ttl = expiresFrom(2)
mutateStore(file, (next) => {
  const entry = next.entries.find((item) => item.id === "c-042")
  entry.content = "更新后的内容 ✅"
  entry.category = "global"
  entry.priority = "low"
  entry.status = "archived"
  entry.project = "新项目"
  entry.expiresAt = ttl
  entry.tags = ["新标签"]
  entry.updatedAt = nowIso()
})
store = loadStore(file)
const updated = store.entries.find((entry) => entry.id === "c-042")
audit.eq("update 后条数不变", store.entries.length, 100)
audit.eq("update content", updated.content, "更新后的内容 ✅")
audit.eq("update category", updated.category, "global")
audit.eq("update priority", updated.priority, "low")
audit.eq("update status", updated.status, "archived")
audit.eq("update project", updated.project, "新项目")
audit.eq("update TTL（expiresAt）", updated.expiresAt, ttl)
audit.check("update TTL 是未来时间", Date.parse(updated.expiresAt) > Date.now(), updated.expiresAt)
audit.eq("update tags", updated.tags, ["新标签"])
audit.eq("update 后 revision", store.revision, 101)

// ── remove ─────────────────────────────────────────────────────────────────
mutateStore(file, (next) => {
  next.entries = next.entries.filter((entry) => entry.id !== "c-042")
})
store = loadStore(file)
audit.eq("remove 后条数", store.entries.length, 99)
audit.check("目标条目已删除", !store.entries.some((entry) => entry.id === "c-042"))
audit.eq("删除后后续条目顺序不变", store.entries[41]?.id, "c-043")
audit.eq("remove 后 revision", store.revision, 102)
audit.eq("删除后 SQLite 实际行数", entryCount(file), 99)

// SQLite 实际行数（绕过 core，直接用 node:sqlite 核对）
audit.eq("SQLite 实际行数", entryCount(file), 99)
audit.check("主库文件不是 4KB 空壳", sizeOf(file) > 4096, `size=${sizeOf(file)}`)

audit.finish()
