/**
 * 用例 2：N 个子进程各 add 25 条（mutateStore），必须一条不少、无重复无丢失；
 * 默认 N=4（本地多核）；CI 的 2 核 runner 用 CORE_AUDIT_WORKERS=2。
 * 同时父进程轮询 revision，检查是否单调递增。
 * 场景 A 用默认重试次数（WRITE_ATTEMPTS=6）；场景 B 用 attempts=20 作对照，
 * 以区分"乐观锁本身有问题"和"默认重试次数不够"。
 */
import { spawn } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync, exists, sleep, workDir } from "./helpers.mjs"
import { Audit } from "./helpers.mjs"
import { loadStore, storageInfo } from "../../core.js"
import { HERE } from "./helpers.mjs"

const audit = new Audit("t02", "多进程并发写满库（默认 4 进程，CI 可调）")

// 0.4.5：并发度跟随机器。默认 4 个写进程（本地/多核）；CI 的 2 核 runner 用
// CORE_AUDIT_WORKERS=2，否则 4 个进程争 SQLite 写锁会撞满 busy_timeout，
// 报的失败是"机器太小"而不是"乐观锁坏了"。断言本身不变（全部成功、无丢失/重复）。
const WORKERS = Math.max(2, Math.min(8, Number(process.env.CORE_AUDIT_WORKERS || 4)))
const PER_WORKER = 25
const TOTAL = WORKERS * PER_WORKER

function workerPath() {
  return join(HERE, "t02-worker.mjs")
}

function runWorker(file, index, count, attempts) {
  const args = [workerPath(), file, String(index), String(count)]
  if (attempts) args.push(String(attempts))
  const child = spawn(process.execPath, args, { stdio: "inherit" })
  return new Promise((resolve) => child.on("exit", (code) => resolve({ index, code })))
}

/** 短连接轮询 revision，避免在测试进程里长期持有连接影响 checkpoint。 */
function pollRevision(file) {
  if (!existsSync(file)) return null
  let db
  try {
    db = new DatabaseSync(file)
    const row = db.prepare("SELECT v FROM meta WHERE k = 'revision'").get()
    return row ? Number(row.v) : 0
  } catch {
    return null
  } finally {
    try {
      db?.close()
    } catch {
      /* ignore */
    }
  }
}

async function scenario({ name, attempts }) {
  const dir = workDir(`t02-${name}`)
  const file = join(dir, "memory.sqlite")
  const expected = new Set()
  for (let w = 0; w < WORKERS; w += 1) for (let i = 0; i < PER_WORKER; i += 1) expected.add(`w${w}-${String(i).padStart(3, "0")}`)

  const seen = []
  let monotonic = true
  let last = -1
  let polling = true
  const poller = (async () => {
    while (polling) {
      const revision = pollRevision(file)
      if (revision !== null) {
        seen.push(revision)
        if (revision < last) monotonic = false
        last = revision
      }
      await sleep(20)
    }
  })()

  const exited = await Promise.all(Array.from({ length: WORKERS }, (_, index) => runWorker(file, index, PER_WORKER, attempts)))
  polling = false
  await poller
  await sleep(150)

  const workers = []
  for (let index = 0; index < WORKERS; index += 1) {
    try {
      workers.push(JSON.parse(readFileSync(`${file}.worker-${index}.json`, "utf8")))
    } catch {
      workers.push({ worker: index, revisions: [], failures: [{ code: "NO_RESULT", message: "worker 未写结果文件" }] })
    }
  }
  const failures = workers.flatMap((worker) => worker.failures.map((failure) => ({ ...failure, worker: worker.worker })))
  const store = loadStore(file)
  const ids = new Set(store.entries.map((entry) => entry.id))
  const missing = [...expected].filter((id) => !ids.has(id))
  const extra = [...ids].filter((id) => !expected.has(id))
  const duplicates = store.entries.length - ids.size
  const label = attempts ? `attempts=${attempts}` : "默认重试"

  audit.check(`[${name}] ${WORKERS} 个 worker 全部正常退出`, exited.every((item) => item.code === 0), JSON.stringify(exited))
  audit.eq(`[${name}] 最终条数（${label}）`, store.entries.length, TOTAL)
  audit.eq(`[${name}] 重复 id 数`, duplicates, 0)
  audit.eq(`[${name}] 丢失 id 数`, missing.length, 0, missing.slice(0, 5).join(","))
  audit.eq(`[${name}] 多余 id 数`, extra.length, 0, extra.slice(0, 5).join(","))
  audit.check(
    `[${name}] 每个 worker 无写入失败（${label}）`,
    failures.length === 0,
    failures.length === 0 ? "" : JSON.stringify(failures.slice(0, 3)),
  )
  audit.check(`[${name}] 每 worker 各自观察到的 revision 严格递增`, workers.every((worker) => worker.revisions.every((item, index) => index === 0 || item.revision > worker.revisions[index - 1].revision)), JSON.stringify(workers.map((worker) => worker.revisions.at(-1))))
  audit.check(`[${name}] 轮询 revision 单调递增`, monotonic, `轮询 ${seen.length} 次，最后 ${seen.at(-1)}`)
  audit.check(`[${name}] revision ≥ 成功写入次数 ${TOTAL}`, Number(store.revision) >= TOTAL, `revision=${store.revision}`)
  audit.eq(`[${name}] storageInfo revision 与 loadStore 一致`, storageInfo(file).revision, store.revision)

  // WAL 与"只拷主库"自包含检查
  const wal = `${file}-wal`
  const walBytes = existsSync(wal) ? statSync(wal).size : -1
  audit.check(`[${name}] 写完后 -wal 为 0 字节（已 TRUNCATE checkpoint）`, walBytes === 0, `walSize=${walBytes} (缺失=-1)`)
  const copyDir = join(dir, "copy-main-only")
  mkdirSync(copyDir, { recursive: true })
  const copyFile = join(copyDir, "memory.sqlite")
  copyFileSync(file, copyFile)
  const copyStore = loadStore(copyFile)
  audit.eq(`[${name}] 只复制主库到新目录可读出全部条目`, copyStore.entries.length, TOTAL)
  audit.check(`[${name}] 副本内容与主库 id 集合一致`, copyStore.entries.length === ids.size && copyStore.entries.every((entry) => ids.has(entry.id)), "")
}

await scenario({ name: "A", attempts: undefined })
await scenario({ name: "B", attempts: 20 })

audit.finish()
