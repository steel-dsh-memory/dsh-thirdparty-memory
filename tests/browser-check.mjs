// 只读审计用：隔离服务 + 无头 Edge 动态验证「记忆内容里的 HTML 是否被执行」和窄屏布局。
// 运行：<DSH_NODE> F:\deepseek\长期记忆\tests\browser-check.mjs
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const NODE = process.execPath
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = dirname(HERE)
const RID = Math.random().toString(36).slice(2, 8)
const TMP = join(HERE, "tmp-browser-" + RID)
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
const server = spawn(NODE, [join(PLUGIN, "server.js")], { cwd: PLUGIN, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
const serverLogs = []
server.stdout.on("data", (d) => serverLogs.push(String(d)))
server.stderr.on("data", (d) => serverLogs.push(String(d)))

async function waitReady() {
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await fetch(`http://127.5.0.1:${PORT}/api/state`, { signal: AbortSignal.timeout(1500) })
      if (r.ok) return true
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

function runEdge(args, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const child = spawn(EDGE, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    const stdout = []
    const stderr = []
    const timer = setTimeout(() => {
      child.kill()
      resolve({ timedOut: true, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") })
    }, timeoutMs)
    child.stdout.on("data", (d) => stdout.push(d))
    child.stderr.on("data", (d) => stderr.push(d))
    child.on("exit", (code) => {
      clearTimeout(timer)
      resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") })
    })
  })
}

const results = []
const check = (id, ok, title, expected, observed) => results.push({ id, ok, title, expected, observed })

const ready = await waitReady()
check("D0", ready, "隔离服务启动", "ready", `ready=${ready} logs=${serverLogs.join(" ").slice(0, 300)}`)

if (ready) {
  const common = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions", `--user-data-dir=${join(TMP, "edge-profile")}`, "--hide-scrollbars"]
  // 动态 XSS：dump-dom，检查载荷是否被当文本插入、以及 onerror 是否有机会执行
  const dom = await runEdge([...common, "--virtual-time-budget=6000", "--dump-dom", `http://127.0.0.1:${PORT}/`])
  const domText = dom.stdout ?? ""
  writeFileSync(join(TMP, "dom.html"), domText, "utf8")
  const escaped = domText.includes("&lt;img src=x onerror=")
  const elementInjected = /<img[^>]+src="?x"?[^>]*onerror/.test(domText)
  const executed = /data-xss="1"/.test(domText)
  check("D1", escaped && !elementInjected && !executed, "记忆内容里的 <img onerror> 不被当成 HTML 执行（DOM 中是转义文本）",
    "内容以文本节点呈现，无 img 元素、无 onerror 执行", `escapedText=${escaped} injectedImgElement=${elementInjected} onerrorExecuted=${executed} domBytes=${domText.length} code=${dom.code} edgeErr=${String(dom.stderr ?? "").slice(0, 200)}`)
  const memoryRendered = domText.includes("普通记忆四") || domText.includes("全局常驻")
  check("D2", memoryRendered, "页面脚本执行并渲染了 /api/state 的内容", "DOM 中出现记忆正文", `memoryRendered=${memoryRendered}`)

  // 窄屏截图（390×844，iPhone 尺寸）
  const shotMobile = join(TMP, "mobile-390x844.png")
  const mob = await runEdge([...common, "--window-size=390,844", "--virtual-time-budget=6000", `--screenshot=${shotMobile}`, `http://127.0.0.1:${PORT}/`])
  check("D3", existsSync(shotMobile) && readFileSync(shotMobile).length > 0, "窄屏截图生成", "png 存在", `exists=${existsSync(shotMobile)} size=${existsSync(shotMobile) ? readFileSync(shotMobile).length : 0} code=${mob.code}`)
  // 桌面截图（对照）
  const shotDesk = join(TMP, "desktop-1280x800.png")
  const desk = await runEdge([...common, "--window-size=1280,800", "--virtual-time-budget=6000", `--screenshot=${shotDesk}`, `http://127.0.0.1:${PORT}/`])
  check("D4", existsSync(shotDesk) && readFileSync(shotDesk).length > 0, "桌面截图生成", "png 存在", `exists=${existsSync(shotDesk)} size=${existsSync(shotDesk) ? readFileSync(shotDesk).length : 0} code=${desk.code}`)
}

server.kill()
await new Promise((resolve) => {
  server.once("exit", resolve)
  setTimeout(resolve, 3000)
})

console.log(`\n==== 浏览器动态检查：${results.filter((r) => r.ok).length}/${results.length} 通过 ====`)
for (const r of results) {
  console.log(`[${r.ok ? "PASS" : "FAIL"}] ${r.id} ${r.title}`)
  if (!r.ok) {
    console.log(`       期望: ${r.expected}`)
    console.log(`       实测: ${r.observed}`)
  }
}
console.log(`临时目录：${TMP}`)
