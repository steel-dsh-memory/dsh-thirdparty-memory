/**
 * 用例 7：WAL。每次写后 -wal 应为 0 字节 / 主库自包含（只拷主库到新目录可读出全部条目）。
 */
import { copyFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { loadStore, mutateStore, normalizeEntry, saveStore } from "../../core.js"
import { Audit, entryCount, exists, sizeOf, workDir } from "./helpers.mjs"

const audit = new Audit("t07", "WAL checkpoint 与主库自包含")

const dir = workDir("t07-wal")
const file = join(dir, "memory.sqlite")

mutateStore(file, (store) => {
  store.entries.push(normalizeEntry({ id: "w1", content: "WAL 测试第一条 中文 🎉" }))
})
const samples = []
samples.push({ step: "add 1", wal: exists(`${file}-wal`) ? sizeOf(`${file}-wal`) : -1, main: sizeOf(file) })

mutateStore(file, (store) => {
  store.entries.push(normalizeEntry({ id: "w2", content: "WAL 测试第二条" }))
  store.entries.push(normalizeEntry({ id: "w3", content: "WAL 测试第三条" }))
})
samples.push({ step: "add 2", wal: exists(`${file}-wal`) ? sizeOf(`${file}-wal`) : -1, main: sizeOf(file) })

// 直接 saveStore（跳过 mutate 的读改写）也要 checkpoint
const store = loadStore(file)
store.entries.push(normalizeEntry({ id: "w4", content: "WAL 测试第四条" }))
saveStore(file, store)
samples.push({ step: "saveStore", wal: exists(`${file}-wal`) ? sizeOf(`${file}-wal`) : -1, main: sizeOf(file) })

for (const sample of samples) {
  audit.check(`[${sample.step}] -wal 为 0 字节`, sample.wal === 0, `wal=${sample.wal} main=${sample.main}`)
}
audit.check("主库不是 4KB 空壳", sizeOf(file) > 4096, `main=${sizeOf(file)}`)
audit.eq("主库内实际条目数（独立连接）", entryCount(file), 4)

// 只拷主库（不带 -wal/-shm）到新目录，必须能读出全部条目
const copyDir = join(dir, "copy-main-only")
mkdirSync(copyDir, { recursive: true })
const copyFile = join(copyDir, "memory.sqlite")
copyFileSync(file, copyFile)
const copyStore = loadStore(copyFile)
audit.eq("只拷主库读出的条目数", copyStore.entries.length, 4)
audit.check("拷贝后条目内容一致", copyStore.entries.map((entry) => entry.content).join("|") === store.entries.map((entry) => entry.content).join("|"))

// 再验证一次：只拷主库后原目录的 -wal 仍在 0
audit.check("拷贝后原库 -wal 仍为 0", !exists(`${file}-wal`) || sizeOf(`${file}-wal`) === 0, `wal=${exists(`${file}-wal`) ? sizeOf(`${file}-wal`) : -1}`)

audit.finish()
