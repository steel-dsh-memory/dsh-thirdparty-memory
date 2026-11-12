/**
 * 依次跑 t01..t12，汇总 results/*.json。
 * 子进程 stdio=inherit：避免沙箱对管道捕获的限制。
 */
import { readdirSync, readFileSync, rmSync, mkdirSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { HERE, RESULTS_DIR, TMP_ROOT } from "./helpers.mjs"

rmSync(RESULTS_DIR, { recursive: true, force: true })
mkdirSync(RESULTS_DIR, { recursive: true })

const files = readdirSync(HERE)
  .filter((name) => /^t\d\d-.+\.mjs$/.test(name) && !name.includes("worker"))
  .sort()

const summary = []
for (const name of files) {
  console.log(`\n================ ${name} ================`)
  const started = performance.now()
  const result = spawnSync(process.execPath, [join(HERE, name)], { stdio: "inherit", timeout: 600_000 })
  const ms = Math.round(performance.now() - started)
  summary.push({ name, status: result.status, wallMs: ms, signal: result.signal ?? "" })
}

console.log("\n================ SUMMARY ================")
let failed = 0
for (const item of summary) {
  const id = item.name.match(/^(t\d\d)/)?.[1]
  let line = `${item.name.padEnd(28)} exit=${item.status} wall=${item.wallMs}ms`
  try {
    const payload = JSON.parse(readFileSync(join(RESULTS_DIR, `${id}.json`), "utf8"))
    line += ` passed=${payload.passed} failed=${payload.failed} core=${payload.ms}ms`
  } catch {
    line += " (no result json)"
  }
  console.log(line)
  if (item.status !== 0) failed += 1
}
console.log(`\nTOTAL test files=${summary.length} 非零退出=${failed}`)
// 0.4.5：有失败就非零退出。以前这里永远 exit 0，本地手动跑会误以为"全过"。
process.exitCode = failed > 0 ? 1 : 0
