/**
 * 用例 9：TTL。
 * expiresFrom(1) → 未过期；构造过去时间 → isLive=false、isExpired=true；
 * selectEntries 不选过期条目；dashboard.expired 计数正确；
 * 同时核对清单里说的 "storageInfo 的 expired 计数" 是否存在。
 */
import { join } from "node:path"
import { dashboard, expiresFrom, isExpired, isLive, loadStore, mutateStore, normalizeEntry, selectEntries, storageInfo } from "../../core.js"
import { Audit, workDir } from "./helpers.mjs"

const audit = new Audit("t09", "TTL 过期语义")

const dir = workDir("t09-ttl")
const file = join(dir, "memory.sqlite")
const future = expiresFrom(1)
const past = new Date(Date.now() - 60_000).toISOString()

audit.check("expiresFrom(1) 返回未来时间", Date.parse(future) > Date.now(), future)
audit.eq("expiresFrom(0) 永久", expiresFrom(0), null)
audit.eq("expiresFrom(-1) 永久", expiresFrom(-1), null)
audit.eq("expiresFrom('abc') 永久", expiresFrom("abc"), null)
audit.eq("expiresFrom(undefined) 永久", expiresFrom(undefined), null)

const liveEntry = normalizeEntry({ id: "ttl-live", content: "未过期记忆", category: "global", expiresAt: future })
audit.check("isLive(未过期)", isLive(liveEntry) === true)
audit.check("isExpired(未过期)", isExpired(liveEntry) === false)

mutateStore(file, (store) => {
  store.entries.push(normalizeEntry({ id: "ttl-live", content: "未过期记忆", category: "global", expiresAt: future }))
  store.entries.push(normalizeEntry({ id: "ttl-dead", content: "已过期记忆", category: "global", expiresAt: past }))
  store.entries.push(normalizeEntry({ id: "ttl-forever", content: "永久记忆", category: "general" }))
})
const store = loadStore(file)
const dead = store.entries.find((entry) => entry.id === "ttl-dead")
audit.check("isLive(已过期)=false", isLive(dead) === false)
audit.check("isExpired(已过期)=true", isExpired(dead) === true)
audit.eq("isLive 不误伤永久条目", isLive(store.entries.find((entry) => entry.id === "ttl-forever")), true)
audit.eq("非法 expiresAt 不判过期", isExpired({ id: "x", status: "active", expiresAt: "not-a-date" }), false)

const selected = selectEntries(store, { query: "记忆", config: {} })
audit.check("selectEntries 不把过期条目选进 always", !selected.always.some((item) => item.entry.id === "ttl-dead"), JSON.stringify(selected.always.map((item) => item.entry.id)))
audit.check("selectEntries 不把过期条目选进 matched", !selected.matched.some((item) => item.entry.id === "ttl-dead"))
audit.check("过期条目进 expired 桶", selected.expired.some((item) => item.entry.id === "ttl-dead"), JSON.stringify(selected.expired.map((item) => item.entry.id)))
audit.check("过期条目不在 rest 里（不参与索引）", !selected.rest.some((item) => item.entry.id === "ttl-dead"))

const dash = dashboard(store, { query: "记忆", config: {} })
audit.eq("dashboard.expired 计数", dash.expired, 1)
audit.eq("dashboard.entries 总数", dash.entries, 3)

const info = storageInfo(file)
audit.check("storageInfo 是否存在 expired 字段", "expired" in info, `字段=${Object.keys(info).join(",")}`)
audit.eq("storageInfo revision", info.revision, store.revision)

audit.finish()
