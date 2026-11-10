// 只读审计用：准备隔离库（含 XSS 载荷与多条记忆）并在 7892 起 server.js，保持运行直到被终止。
// 由 tests/browser-run.ps1 配合无头 Edge 使用。
import { spawn } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = dirname(HERE)
const TMP = join(HERE, "tmp-browser-live")
if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })
const DATA = join(TMP, "memory.sqlite")
const LEGACY = join(TMP, "legacy-none.json")
const PATCH = join(TMP, "cordis.patch.yml")
const PORT = 7892
writeFileSync(PATCH, "plugins:\n  - id: thirdparty-memory\n    enabled: true\n    autoExtract: true\n    inbox: true\n", "utf8")

const core = await import(pathToFileURL(join(PLUGIN, "core.js")).href)
const XSS = '<img src=x onerror="document.documentElement.setAttribute(\'data-xss\',\'1\')">'
core.mutateStore(
  DATA,
  (store) => {
    const rows = [
      { content: "全局常驻：窄屏布局测试 memory one", category: "global", priority: "high", source: "user" },
      { content: "用户画像：测试 narrow layout", category: "persona", source: "auto", status: "active" },
      { content: "普通记忆二：这是一条比较长的记忆内容，用来观察窄屏下正文是否被挤压到不可读。", category: "general", source: "user", tags: ["布局", "long"] },
      { content: "普通记忆三：deploy config docs", category: "general", source: "user" },
      { content: "普通记忆四：搜索关键词测试", category: "general", source: "auto" },
      { content: "XSS probe " + XSS, category: "general", source: "user" },
      { content: "待审批记忆 pending item", category: "general", source: "auto", status: "pending" },
    ]
    for (const row of rows) store.entries.push(core.normalizeEntry(row))
    return null
  },
  { legacyFile: LEGACY },
)

const env = {
  ...process.env,
  MEMORY_PAGE_HOST: "127.5.0.1",
  MEMORY_PAGE_PORT: String(PORT),
  MEMORY_DATA_FILE: DATA,
  MEMORY_LEGACY_FILE: LEGACY,
  MEMORY_PAGE_ALSO: "",
  MEMORY_PATCH_FILE: PATCH,
  MEMORY_LANG: "zh-CN",
}
const server = spawn(process.execPath, [join(PLUGIN, "server.js")], { cwd: PLUGIN, env, windowsHide: true, stdio: ["ignore", "inherit", "inherit"] })
server.on("exit", (code) => {
  console.log("[fixture] server exit", code)
  process.exit(0)
})
process.on("SIGTERM", () => {
  server.kill()
  setTimeout(() => process.exit(0), 500)
})
process.on("SIGINT", () => {
  server.kill()
  setTimeout(() => process.exit(0), 500)
})
console.log("[fixture] data=" + DATA)
console.log("[fixture] url=http://127.0.0.1:" + PORT + "/")
setInterval(() => {}, 1 << 30)
