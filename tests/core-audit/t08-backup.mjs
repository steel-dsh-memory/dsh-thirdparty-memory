/**
 * 用例 8：自动备份。
 * 8a：last_backup_at 强制归零触发一次备份，检查 backups/ 下 VACUUM 快照可独立打开且条数一致；
 * 8b：保留 30 份逻辑（造 35 份假文件 + 自定义 backupKeep）。
 */
import { join } from "node:path"
import { writeFileSync } from "node:fs"
import { loadStore, mutateStore, normalizeEntry } from "../../core.js"
import { Audit, DatabaseSync, entryCount, exists, listSqliteBackups, metaValue, sleep, workDir } from "./helpers.mjs"

const audit = new Audit("t08", "VACUUM 备份与保留份数")

const dir = workDir("t08-backup")
const file = join(dir, "memory.sqlite")
const backupsDir = join(dir, "backups")

mutateStore(file, (store) => {
  for (let index = 0; index < 3; index += 1) store.entries.push(normalizeEntry({ id: `b${index}`, content: `备份测试 ${index}` }))
})
// 首次写：last_backup_at 为 0 → 自动触发一次
audit.eq("首次写入自动触发备份", listSqliteBackups(backupsDir).length, 1)
audit.check("meta.last_backup_at 已写", Number(metaValue(file, "last_backup_at") ?? 0) > 0, String(metaValue(file, "last_backup_at")))
const firstBackup = listSqliteBackups(backupsDir)[0]
audit.eq("首次备份可独立打开且条数一致", entryCount(join(backupsDir, firstBackup)), 3)

// 8a：把 last_backup_at 改成 0，再写一次触发备份
const db = new DatabaseSync(file)
db.prepare("UPDATE meta SET v = ? WHERE k = 'last_backup_at'").run("0")
db.close()
await sleep(30)
mutateStore(
  file,
  (store) => {
    store.entries.push(normalizeEntry({ id: "b3", content: "触发第二次备份" }))
  },
  { backupIntervalMs: 0 },
)
const backups = listSqliteBackups(backupsDir)
audit.check("第二次备份已生成", backups.length >= 2, `backups=${backups.length}`)
const newest = backups.at(-1)
const snapshotCount = entryCount(join(backupsDir, newest))
audit.eq("最新快照可独立打开且条数一致（4 条）", snapshotCount, 4)
audit.check("备份是自包含单文件（没有配套 -wal）", !exists(join(backupsDir, `${newest}-wal`)), newest)
// 只拷快照到别处也能读出
const copyDir = join(dir, "snapshot-copy")
const copyFile = join(copyDir, "snapshot.sqlite")
const { mkdirSync, copyFileSync } = await import("node:fs")
mkdirSync(copyDir, { recursive: true })
copyFileSync(join(backupsDir, newest), copyFile)
audit.eq("拷贝出去的快照可独立读出 4 条", entryCount(copyFile), 4)

// 8b：保留 30 份 —— 先造 35 份 2020 年的假备份
for (let index = 0; index < 35; index += 1) {
  const stamp = `2020-01-01T00-00-${String(index).padStart(2, "0")}-000Z`
  writeFileSync(join(backupsDir, `memory-${stamp}.sqlite`), "fake backup placeholder", "utf8")
}
audit.eq("造假后文件数", listSqliteBackups(backupsDir).length, 35 + backups.length)
await sleep(30)
mutateStore(
  file,
  (store) => {
    store.entries.push(normalizeEntry({ id: "b4", content: "触发保留份数清理" }))
  },
  { backupIntervalMs: 0 },
)
const afterPrune = listSqliteBackups(backupsDir)
audit.eq("默认 BACKUP_KEEP=30：清理后保留 30 份", afterPrune.length, 30)
audit.check("最老的 2020 假备份被删掉", afterPrune.filter((name) => name.includes("2020-01-01")).length < 35, `剩余假备份=${afterPrune.filter((name) => name.includes("2020-01-01")).length}`)
audit.check("最新真实备份仍在", afterPrune.includes(newest), `newest=${newest}`)
audit.eq("清理后最新快照条数", entryCount(join(backupsDir, afterPrune.at(-1))), 5)
audit.check("清理后目录内文件数 = 30", afterPrune.length === 30, `count=${afterPrune.length}`)

// 自定义 backupKeep=3
for (let index = 0; index < 10; index += 1) {
  writeFileSync(join(backupsDir, `memory-2021-01-01T00-00-${String(index).padStart(2, "0")}-000Z.sqlite`), "fake", "utf8")
}
await sleep(30)
mutateStore(
  file,
  (store) => {
    store.entries.push(normalizeEntry({ id: "b5", content: "触发 backupKeep=3" }))
  },
  { backupIntervalMs: 0, backupKeep: 3 },
)
const afterKeep3 = listSqliteBackups(backupsDir)
audit.eq("backupKeep=3：只保留 3 份", afterKeep3.length, 3)
audit.eq("保留的 3 份里最新快照条数", entryCount(join(backupsDir, afterKeep3.at(-1))), 6)

audit.finish()
