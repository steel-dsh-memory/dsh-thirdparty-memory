/** 用例 3：乐观锁 —— 旧 revision 直接 saveStore 必须 MEMORY_CONFLICT；mutateStore 自动重试必须成功。 */
import { join } from "node:path"
import { loadStore, mutateStore, normalizeEntry, saveStore } from "../../core.js"
import { Audit, workDir } from "./helpers.mjs"

const dir = workDir("t03-optimistic-lock")
const file = join(dir, "memory.sqlite")
const audit = new Audit("t03", "乐观锁 revision")

mutateStore(file, (store) => {
  store.entries.push(normalizeEntry({ id: "a", content: "第一条" }))
})
const stale = loadStore(file) // revision 1

mutateStore(file, (store) => {
  store.entries.push(normalizeEntry({ id: "b", content: "第二条" }))
}) // revision 2

let conflict = null
try {
  saveStore(file, stale)
} catch (error) {
  conflict = error
}
audit.check("旧 revision 的 saveStore 抛 MEMORY_CONFLICT", conflict?.code === "MEMORY_CONFLICT", String(conflict?.message ?? "没有抛错"))
let after = loadStore(file)
audit.eq("冲突后条数（旧副本没有覆盖新数据）", after.entries.length, 2)
audit.eq("冲突后 revision 未变", after.revision, 2)
audit.check("两条数据都在", after.entries.some((entry) => entry.id === "a") && after.entries.some((entry) => entry.id === "b"))

// ── mutateStore 自动重试：第一次调用 mutator 时用另一份旧副本旁路写入抬 revision ──
let calls = 0
const sideChannel = loadStore(file) // revision 2
const outcome = mutateStore(file, (store) => {
  calls += 1
  if (calls === 1) {
    sideChannel.entries.push(normalizeEntry({ id: "side", content: "旁路进程写入" }))
    saveStore(file, sideChannel) // revision 2 → 3，制造冲突
  }
  store.entries.push(normalizeEntry({ id: "retry", content: "重试后写入" }))
  return { calls }
})
after = loadStore(file)
audit.eq("mutateStore 发生了一次真实冲突并重试（mutator 被调用 2 次）", calls, 2)
audit.eq("重试后 revision", after.revision, 4)
audit.eq("旁路写入未被吞掉", after.entries.filter((entry) => entry.id === "side").length, 1)
audit.eq("重试写入只落一条（没有重复）", after.entries.filter((entry) => entry.id === "retry").length, 1)
audit.eq("总条数", after.entries.length, 4)
audit.eq("mutateStore 返回值透传", outcome, { calls: 2 })

// ── __skipWrite：不落盘、不抬 revision ──
const before = loadStore(file).revision
const skipped = mutateStore(file, () => ({ __skipWrite: true, reason: "测试跳过" }))
audit.eq("__skipWrite 返回值", skipped.reason, "测试跳过")
audit.eq("__skipWrite 不抬 revision", loadStore(file).revision, before)

// ── 连续 6 次都冲突时，mutateStore 应在重试耗尽后抛出 MEMORY_CONFLICT（而不是死循环） ──
let exhausted = null
let bumpCalls = 0
try {
  mutateStore(
    file,
    (store) => {
      bumpCalls += 1
      // 每次都用最新 revision 旁路写入，保证外层 save 每次都撞冲突
      const fresh = loadStore(file)
      fresh.entries.push(normalizeEntry({ id: `bump-${bumpCalls}`, content: "持续制造冲突" }))
      saveStore(file, fresh)
      store.entries.push(normalizeEntry({ id: `never-${bumpCalls}`, content: "永远写不进去" }))
    },
    { attempts: 3 },
  )
} catch (error) {
  exhausted = error
}
audit.check("重试耗尽抛 MEMORY_CONFLICT", exhausted?.code === "MEMORY_CONFLICT", String(exhausted?.message ?? "没有抛错"))
audit.eq("重试次数上限（attempts=3 → mutator 3 次）", bumpCalls, 3)
audit.check(
  "耗尽的写入没有落库（keep 条目不存在）",
  !loadStore(file).entries.some((entry) => String(entry.id).startsWith("never-")),
)

audit.finish()
