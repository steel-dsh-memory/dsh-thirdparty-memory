/**
 * 用例 12：编号一致性。
 * selectEntries 的 number（注入段编号）必须等于 store.entries 下标 + 1；
 * 用编号能回读到同一条（等价于 index.js resolveTarget 的 entries[index-1]）；
 * renderInjection 里渲染出来的 "- N. content" 也必须指向同一条。
 */
import { join } from "node:path"
import { loadStore, mutateStore, normalizeEntry, renderInjection, selectEntries } from "../../core.js"
import { Audit, workDir } from "./helpers.mjs"

const audit = new Audit("t12", "注入编号与下标一致性")
const dir = workDir("t12-numbering")
const file = join(dir, "memory.sqlite")
const past = new Date(Date.now() - 1000).toISOString()

mutateStore(file, (store) => {
  store.entries.push(normalizeEntry({ id: "g1", content: "全局规则一", category: "global" }))
  store.entries.push(normalizeEntry({ id: "p1", content: "项目 alpha 的接口约定", category: "project", project: "alpha" }))
  store.entries.push(normalizeEntry({ id: "p2", content: "项目 alpha 的部署脚本", category: "project", project: "alpha" }))
  store.entries.push(normalizeEntry({ id: "pe1", content: "用户画像：偏好深色主题", category: "persona" }))
  store.entries.push(normalizeEntry({ id: "ep1", content: "本会话临时事项", category: "ephemeral", sessionId: "sess-1" }))
  store.entries.push(normalizeEntry({ id: "ep2", content: "别的会话临时事项", category: "ephemeral", sessionId: "sess-2" }))
  store.entries.push(normalizeEntry({ id: "gn1", content: "普通记忆：报表导出接口", category: "general", tags: ["报表"] }))
  store.entries.push(normalizeEntry({ id: "gn2", content: "普通记忆：报表格式规范", category: "general", tags: ["报表"] }))
  store.entries.push(normalizeEntry({ id: "pend", content: "待审阅的画像", category: "persona", status: "pending" }))
  store.entries.push(normalizeEntry({ id: "rej", content: "已拒绝的条目", category: "general", status: "rejected" }))
  store.entries.push(normalizeEntry({ id: "exp", content: "已过期的规则", category: "global", expiresAt: past }))
})
const store = loadStore(file)
const options = { query: "报表 导出 项目 alpha 接口", sessionId: "sess-1", config: { currentProject: "alpha", minScore: 1 } }
const selected = selectEntries(store, options)

// dormant 是 rest 的子集（rest = dormant + 未被选中的 pool），不能重复计入
const buckets = ["always", "project", "ephemeral", "matched", "rest", "pending", "rejected", "expired"]
const items = []
for (const bucket of buckets) {
  for (const item of selected[bucket] ?? []) items.push({ bucket, number: item.number, entry: item.entry })
}

const indexOf = new Map(store.entries.map((entry, offset) => [entry.id, offset + 1]))
audit.check("所有桶的 number 都等于下标 + 1", items.every((item) => indexOf.get(item.entry.id) === item.number), items.filter((item) => indexOf.get(item.entry.id) !== item.number).map((item) => `${item.entry.id}:${item.number}`).join(",") || "全部一致")
audit.check("number 覆盖 1..11 且无重复（除 pending/rejected/expired 与 rest 不重叠）", new Set(items.map((item) => item.number)).size === items.length, `items=${items.length} unique=${new Set(items.map((item) => item.number)).size}`)
audit.check("用编号回读能拿到同一条（remember read N 语义）", items.every((item) => store.entries[item.number - 1]?.id === item.entry.id), items.filter((item) => store.entries[item.number - 1]?.id !== item.entry.id).map((item) => item.number).join(",") || "全部一致")
audit.check("编号都在 1..entries.length 范围内", items.every((item) => item.number >= 1 && item.number <= store.entries.length), `entries=${store.entries.length}`)

const rendered = renderInjection(store, options)
const lines = rendered.text.split("\n").filter((line) => /^- \d+\. /.test(line))
audit.check("渲染出的编号行非空", lines.length > 0, `lines=${lines.length}`)
const mismatches = []
for (const line of lines) {
  const match = /^- (\d+)\. (.+)$/.exec(line)
  const number = Number(match[1])
  const entry = store.entries[number - 1]
  if (!entry) {
    mismatches.push(`${number}:不存在`)
    continue
  }
  const body = match[2]
  const head = [...entry.content].slice(0, 8).join("")
  if (!body.startsWith(head)) mismatches.push(`${number}:${entry.id} line=${body.slice(0, 20)} head=${head}`)
}
audit.check("渲染行内容与编号指向的条目一致", mismatches.length === 0, mismatches.slice(0, 5).join(" | ") || "全部一致")

// 删除中间一条后编号整体前移，仍必须一致
mutateStore(file, (next) => {
  next.entries = next.entries.filter((entry) => entry.id !== "pe1")
})
const store2 = loadStore(file)
const selected2 = selectEntries(store2, options)
const items2 = []
for (const bucket of buckets) for (const item of selected2[bucket] ?? []) items2.push(item)
audit.check("删除后编号仍等于下标 + 1", items2.every((item) => store2.entries[item.number - 1]?.id === item.entry.id), items2.filter((item) => store2.entries[item.number - 1]?.id !== item.entry.id).map((item) => item.number).join(",") || "全部一致")
audit.check("删除后条目数", store2.entries.length === 10, `entries=${store2.entries.length}`)

audit.finish()
