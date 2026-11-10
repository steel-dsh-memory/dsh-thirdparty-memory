/**
 * 用例 11：5000 条性能（performance.now）。
 * 报告 loadStore / renderInjection / dashboard 的耗时；阈值只作参考，数字必须写进报告。
 */
import { join } from "node:path"
import { dashboard, loadStore, mutateStore, normalizeEntry, renderInjection, saveStore } from "../../core.js"
import { Audit, entryCount, sizeOf, workDir } from "./helpers.mjs"

const audit = new Audit("t11", "5000 条性能")
const N = 5000
const dir = workDir("t11-perf")
const file = join(dir, "memory.sqlite")
const query = "帮我看看项目 alpha 的接口部署细节，再整理一下性能测试的结论"

const tWrite = performance.now()
mutateStore(file, (store) => {
  for (let index = 1; index <= N; index += 1) {
    store.entries.push(
      normalizeEntry({
        id: `p-${index}`,
        content: `性能测试第 ${index} 条：项目 alpha 的接口 ${index % 50} 与部署细节 ${"x".repeat(40)} 记忆编号 ${index}`,
        category: index % 10 === 0 ? "project" : "general",
        project: "alpha",
        priority: "medium",
        tags: ["alpha", "性能"],
        sessionId: "",
      }),
    )
  }
})
const writeMs = Math.round(performance.now() - tWrite)
audit.eq("写入 5000 条", entryCount(file), N)
audit.check("5000 条写入耗时（含向量构建 + 首次备份）", writeMs < 60_000, `${writeMs} ms`)

const measure = (fn, rounds = 3) => {
  const times = []
  let last
  for (let index = 0; index < rounds; index += 1) {
    const t0 = performance.now()
    last = fn()
    times.push(performance.now() - t0)
  }
  times.sort((left, right) => left - right)
  return { ms: Math.round(times[Math.floor(times.length / 2)]), min: Math.round(times[0]), max: Math.round(times.at(-1)), last, times: times.map((value) => Math.round(value)) }
}

const loadResult = measure(() => loadStore(file))
const renderResult = measure(() => renderInjection(loadResult.last, { query, config: {} }))
const dashResult = measure(() => dashboard(loadResult.last, { query, config: {} }))
const saveResult = measure(() => {
  const store = loadResult.last
  store.entries[0].content = `性能测试第 1 条（改写 ${Date.now()}）`
  saveStore(file, store)
  return store
}, 1)

audit.eq("loadStore 读到 5000 条", loadResult.last.entries.length, N)
audit.check("loadStore 5000 条中位耗时", loadResult.ms < 200, `${loadResult.ms} ms（min=${loadResult.min} max=${loadResult.max} samples=${loadResult.times.join("/")}）`)
audit.check("renderInjection 5000 条中位耗时", renderResult.ms < 500, `${renderResult.ms} ms（min=${renderResult.min} max=${renderResult.max} samples=${renderResult.times.join("/")}）bytes=${renderResult.last.bytes} tokens=${renderResult.last.tokens} 选入=${renderResult.last.selected.always.length + renderResult.last.selected.matched.length} 索引=${renderResult.last.selected.rest.length}`)
audit.check("dashboard 5000 条中位耗时", dashResult.ms < 800, `${dashResult.ms} ms（min=${dashResult.min} max=${dashResult.max} samples=${dashResult.times.join("/")}）entries=${dashResult.last.entries} tokens=${dashResult.last.tokens}`)
audit.check("saveStore 重写 5000 条耗时", saveResult.times[0] < 60_000, `${saveResult.times[0]} ms`)
audit.check("主库大小合理", sizeOf(file) > 1_000_000, `${(sizeOf(file) / 1024 / 1024).toFixed(2)} MB`)

audit.finish()
