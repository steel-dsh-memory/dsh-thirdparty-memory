/**
 * t02 的并发 worker：由 t02-concurrency.mjs 以子进程方式启动。
 * 用法：node t02-worker.mjs <dbFile> <workerIndex> <count> [attempts]
 * 结果写到 <dbFile>.worker-<index>.json（不靠管道捕获，避免沙箱 EPERM）。
 */
import { writeFileSync } from "node:fs"
import { loadStore, mutateStore, normalizeEntry } from "../../core.js"

const [file, workerIndexRaw, countRaw, attemptsRaw] = process.argv.slice(2)
const workerIndex = Number(workerIndexRaw)
const count = Number(countRaw)
const attempts = attemptsRaw ? Number(attemptsRaw) : undefined

const revisions = []
const failures = []
for (let i = 0; i < count; i += 1) {
  const id = `w${workerIndex}-${String(i).padStart(3, "0")}`
  try {
    mutateStore(
      file,
      (store) => {
        store.entries.push(
          normalizeEntry({
            id,
            content: `worker ${workerIndex} item ${i} 中文内容`,
            category: "general",
          }),
        )
      },
      attempts ? { attempts } : {},
    )
    revisions.push({ id, revision: loadStore(file).revision })
  } catch (error) {
    failures.push({ id, code: String(error?.code ?? ""), message: String(error?.message ?? error) })
  }
}

writeFileSync(
  `${file}.worker-${workerIndex}.json`,
  JSON.stringify({ worker: workerIndex, attempts: attempts ?? "default", revisions, failures }, null, 2),
  "utf8",
)
