// 只读审计用：隔离数据目录 + 非 7891 端口启动 server.js，逐端点正常/异常测试。
// 运行：<DSH_NODE> F:\deepseek\长期记忆\tests\http-audit.mjs
// 只写 F:\deepseek\长期记忆\tests\tmp-http-* 下的隔离数据，不碰真实记忆库。
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const NODE = process.execPath
const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = dirname(HERE)
const SERVER = join(PLUGIN, "server.js")
const CORE = pathToFileURL(join(PLUGIN, "core.js")).href

const RID = Math.random().toString(36).slice(2, 8)
const TMP_A = join(HERE, "tmp-http-A-" + RID)
const TMP_B = join(HERE, "tmp-http-B-" + RID)
const DATA_A = join(TMP_A, "memory.sqlite")
const DATA_B = join(TMP_B, "memory.sqlite")
const LEGACY_A = join(TMP_A, "legacy-does-not-exist.json")
const LEGACY_B = join(TMP_B, "legacy-does-not-exist.json")
const PATCH_A = join(TMP_A, "cordis.patch.yml")
const PATCH_B = join(TMP_B, "cordis.patch.yml")
const PORT_A = 7893
const PORT_B = 7892

mkdirSync(TMP_A, { recursive: true })
mkdirSync(TMP_B, { recursive: true })
const PATCH_TEXT = [
  "plugins:",
  "  - id: thirdparty-memory",
  "    enabled: true",
  "    autoExtract: true",
  "    inbox: true",
  "",
].join("\n")
writeFileSync(PATCH_A, PATCH_TEXT, "utf8")
writeFileSync(PATCH_B, PATCH_TEXT, "utf8")

const results = []
function check(id, name, ok, expected, observed) {
  results.push({ id, name, ok, expected, observed })
}
function brief(value, max = 260) {
  let text
  try {
    text = typeof value === "string" ? value : JSON.stringify(value)
  } catch {
    text = String(value)
  }
  if (text === undefined) text = String(value)
  return text.length > max ? text.slice(0, max) + "…" : text
}

// ── 服务进程管理 ───────────────────────────────────────────────────────────
function startServer(port, dataFile, legacyFile, patchFile, tag) {
  const env = {
    ...process.env,
    MEMORY_PAGE_HOST: "127.5.0.1",
    MEMORY_PAGE_PORT: String(port),
    MEMORY_DATA_FILE: dataFile,
    MEMORY_LEGACY_FILE: legacyFile,
    MEMORY_PAGE_ALSO: "",
    MEMORY_PATCH_FILE: patchFile,
    MEMORY_LANG: "en",
  }
  const child = spawn(NODE, [SERVER], { cwd: PLUGIN, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
  const logs = []
  child.stdout.on("data", (d) => logs.push(String(d)))
  child.stderr.on("data", (d) => logs.push("[stderr] " + String(d)))
  child.on("exit", (code) => logs.push(`[exit] ${code}`))
  return { child, logs, tag }
}

async function waitReady(port, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(`http://127.5.0.1:${port}/api/state`, { signal: AbortSignal.timeout(1500) })
      if (r.ok) return true
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  return false
}

async function stopServer(srv) {
  srv.child.kill()
  await new Promise((resolve) => {
    if (srv.child.exitCode !== null) return resolve()
    srv.child.once("exit", resolve)
    setTimeout(resolve, 3000)
  })
}

// ── HTTP 工具 ──────────────────────────────────────────────────────────────
const base = (port) => `http://127.5.0.1:${port}`
async function req(port, method, path, opts = {}) {
  const init = { method, headers: { ...(opts.headers ?? {}) }, signal: AbortSignal.timeout(opts.timeout ?? 8000) }
  if (opts.body !== undefined) {
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)
    if (opts.contentType !== false) init.headers["content-type"] = opts.contentType ?? "application/json"
  }
  try {
    const response = await fetch(base(port) + path, init)
    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      /* non-json */
    }
    return { status: response.status, headers: Object.fromEntries(response.headers), text, json }
  } catch (error) {
    return { error: String(error?.message ?? error), cause: String(error?.cause?.code ?? error?.cause?.message ?? "") }
  }
}
const json = (r) => r.json ?? {}
const statusOf = (r) => (r.error ? `fetch-error(${r.cause || r.error})` : r.status)

// ── 隔离库种子（只写隔离目录）──────────────────────────────────────────────
const core = await import(CORE)
function seed(entries) {
  return core.mutateStore(
    DATA_A,
    (store) => {
      for (const entry of entries) store.entries.push(core.normalizeEntry(entry))
      return null
    },
    { legacyFile: LEGACY_A },
  )
}
function countEntries(port = PORT_A) {
  return req(port, "GET", "/api/state").then((r) => (r.error ? -1 : json(r).entries.length))
}
async function findEntry(port, content) {
  const r = await req(port, "GET", "/api/state")
  return (json(r).entries ?? []).find((entry) => entry.content === content)
}

// ════════════════════════════════════════════════════════════════════════
// 阶段 A：干净隔离库 + 种子 2 条 pending
// ════════════════════════════════════════════════════════════════════════
seed([
  { content: "pending alpha about deploy", category: "general", project: "projA", tags: ["x"], status: "pending", source: "auto" },
  { content: "pending beta about config", category: "project", project: "projA", tags: ["y"], status: "pending", source: "auto" },
])
const srvA = startServer(PORT_A, DATA_A, LEGACY_A, PATCH_A, "A")
if (!(await waitReady(PORT_A))) {
  console.error("A: server did not start", srvA.logs.join(""))
  process.exit(1)
}

// A0 初始状态
{
  const r = await req(PORT_A, "GET", "/api/state")
  const s = json(r)
  check("A0", "GET /api/state 正常 + SQLite 后端 + 隔离库路径", r.status === 200 && s.storage?.backend === "sqlite" && s.dataFile === DATA_A && s.entries?.length === 2 && s.degraded == null,
    "200 / backend=sqlite / entries=2 / degraded=null / dataFile=隔离库", `status=${statusOf(r)} backend=${s.storage?.backend} entries=${s.entries?.length} degraded=${JSON.stringify(s.degraded)} dataFile=${s.dataFile}`)
  check("A0b", "初始 settings.overrides 为空", brief(s.settings?.overrides) === "{}", "{}", brief(s.settings?.overrides))
  check("A0c", "config.enabled/autoExtract/inbox 来自 patch 文件", s.config?.enabled === true && s.config?.autoExtract === true && s.config?.inbox === true, "true/true/true", `${s.config?.enabled}/${s.config?.autoExtract}/${s.config?.inbox}`)
}

// A1 GET /
{
  const r = await req(PORT_A, "GET", "/")
  const html = r.text ?? ""
  check("A1", "GET / 200 + html + CSP + 语言脚本注入", r.status === 200 && String(r.headers["content-type"] ?? "").includes("text/html") && String(r.headers["content-security-policy"] ?? "").includes("default-src 'none'") && html.includes('window.__DSH_MEMORY_LANG__="en"') && !html.includes("<!--__LANG_SCRIPT__-->"),
    "200 html + CSP + lang 脚本已注入", `status=${statusOf(r)} ctype=${r.headers?.["content-type"]} csp=${r.headers?.["content-security-policy"]} langScript=${html.includes('window.__DSH_MEMORY_LANG__="en"')} placeholderLeft=${html.includes("<!--__LANG_SCRIPT__-->")} bytes=${html.length}`)
  check("A1b", "GET / 未泄漏服务端路径或源码", !html.includes("server.js") && !html.includes(DATA_A), "页面不包含 server.js / 数据路径", `containsServerJs=${html.includes("server.js")} containsDataPath=${html.includes(DATA_A)}`)
}

// A2 export
{
  const r = await req(PORT_A, "GET", "/api/export")
  const s = json(r)
  const keys = Object.keys(s)
  const entryKeys = Object.keys(s.entries?.[0] ?? {})
  const expected = ["id", "content", "category", "project", "priority", "tags", "source", "status", "pinned", "expiresAt", "sessionId", "createdAt", "updatedAt"]
  check("A2", "GET /api/export 返回 version/settings/entries", r.status === 200 && keys.includes("version") && keys.includes("settings") && Array.isArray(s.entries) && s.entries.length === 2,
    "200 + {version,settings,entries} + entries=2", `status=${statusOf(r)} keys=${keys.join(",")} entries=${s.entries?.length}`)
  check("A2b", "export 条目包含全部归一化字段", expected.every((k) => entryKeys.includes(k)), expected.join(","), entryKeys.join(","))
  check("A2c", "export 顶层未包含 degraded / dataFile（降级时无法从导出文件判断）", keys.includes("degraded") && keys.includes("dataFile"), "含 degraded+dataFile（更安全）", `keys=${keys.join(",")}`)
}

// A3/A4/A5 preview
{
  const r = await req(PORT_A, "POST", "/api/preview", { body: {} })
  const s = json(r)
  check("A3", "POST /api/preview 正常", r.status === 200 && typeof s.text === "string" && typeof s.bytes === "number" && typeof s.tokens === "number" && s.marks && typeof s.maxBytes === "number",
    "200 + text/bytes/tokens/marks/maxBytes", `status=${statusOf(r)} keys=${Object.keys(s).join(",")} bytes=${s.bytes} maxBytes=${s.maxBytes}`)
  const noType = await req(PORT_A, "POST", "/api/preview", { body: {}, contentType: false })
  check("A4", "缺 content-type → 415", noType.status === 415, "415", `status=${statusOf(noType)} body=${brief(noType.text)}`)
  const bad = await req(PORT_A, "POST", "/api/preview", { body: "{bad json" })
  check("A5", "坏 JSON → 400", bad.status === 400, "400", `status=${statusOf(bad)} body=${brief(bad.text)}`)
}

// A6 add 正常（全字段）
const FULL = "full field memory"
{
  const r = await req(PORT_A, "POST", "/api/entry/add", { body: { content: "  " + FULL + "  ", category: "project", priority: "high", project: "proj-full", tags: "a, b，c", ttlDays: 7 } })
  const s = json(r)
  const entry = (s.entries ?? []).find((e) => e.content === FULL)
  check("A6", "POST /api/entry/add 全字段 + trim + ttl", r.status === 200 && entry && entry.category === "project" && entry.priority === "high" && entry.project === "proj-full" && brief(entry.tags) === '["a","b","c"]' && typeof entry.expiresAt === "string" && entry.status === "active" && entry.source === "user" && entry.pinned === false && s.entries.length === 3,
    "200 / 字段全保存 / tags 三分 / expiresAt 有值 / source=user", `status=${statusOf(r)} entries=${s.entries?.length} entry=${brief(entry)}`)
}

// A7 duplicate
{
  const r = await req(PORT_A, "POST", "/api/entry/add", { body: { content: FULL } })
  check("A7", "重复内容 → 409", r.status === 409, "409", `status=${statusOf(r)} body=${brief(r.text)}`)
}

// A8/A9 content 校验
{
  const r1 = await req(PORT_A, "POST", "/api/entry/add", { body: { content: "" } })
  const r2 = await req(PORT_A, "POST", "/api/entry/add", { body: { content: "   " } })
  const r3 = await req(PORT_A, "POST", "/api/entry/add", { body: {} })
  check("A8", "缺/空 content → 400", r1.status === 400 && r2.status === 400 && r3.status === 400, "均 400", `empty=${statusOf(r1)} spaces=${statusOf(r2)} missing=${statusOf(r3)}`)
}

// A10 超长内容（>2048 字节）
{
  const r = await req(PORT_A, "POST", "/api/entry/add", { body: { content: "x".repeat(3000) } })
  check("A10", "content > 2048 字节 → 400 + 明确文案", r.status === 400 && String(json(r).error ?? "").includes("2048"), "400 + 提示 2048", `status=${statusOf(r)} body=${brief(r.text)}`)
}

// A11 非法 category/priority（静默回退）
{
  const r = await req(PORT_A, "POST", "/api/entry/add", { body: { content: "invalid enums memory", category: "evil", priority: "urgent" } })
  const entry = (json(r).entries ?? []).find((e) => e.content === "invalid enums memory")
  check("A11", "非法 category/priority → 200 静默回退 general/medium（无 400）", r.status === 200 && entry?.category === "general" && entry?.priority === "medium",
    "200 / general / medium", `status=${statusOf(r)} category=${entry?.category} priority=${entry?.priority}`)
}

// A12/A13 非对象 JSON
{
  const r1 = await req(PORT_A, "POST", "/api/entry/add", { body: "[]" })
  const r2 = await req(PORT_A, "POST", "/api/entry/add", { body: "null" })
  const r3 = await req(PORT_A, "POST", "/api/entry/add", { body: '"str"' })
  check("A12", "非对象 JSON（[]/null/str）→ 400", r1.status === 400 && r2.status === 400 && r3.status === 400, "均 400", `array=${statusOf(r1)} null=${statusOf(r2)} string=${statusOf(r3)}`)
}

// A14/A15 content-type 变体
{
  const r1 = await req(PORT_A, "POST", "/api/entry/add", { body: { content: "no type mem" }, contentType: false })
  const r2 = await req(PORT_A, "POST", "/api/entry/add", { body: { content: "text plain mem" }, contentType: "text/plain" })
  check("A14", "缺 content-type / text/plain → 415", r1.status === 415 && r2.status === 415, "均 415", `missing=${statusOf(r1)} textplain=${statusOf(r2)}`)
}

// A16 超大 body（>128KB）
{
  const r = await req(PORT_A, "POST", "/api/entry/add", { body: { content: "y".repeat(200 * 1024) }, timeout: 12000 })
  check("A16", "body >128KB → 期望 413（实际可能连接被 destroy）", r.status === 413, "413 + {error:'body too large'}", `observed=${statusOf(r)} body=${brief(r.text ?? r.error)}`)
}
// A17 128KB 边界
{
  const prefix = '{"content":"boundary-ok","pad":"'
  const suffix = '"}'
  const exact = 128 * 1024
  const padLen1 = exact - Buffer.byteLength(prefix) - Buffer.byteLength(suffix)
  const body1 = prefix + "z".repeat(padLen1) + suffix
  const body2 = prefix + "z".repeat(padLen1 + 1) + suffix
  check("A17-prep", "边界 body 字节数正确", Buffer.byteLength(body1) === exact && Buffer.byteLength(body2) === exact + 1, `${exact}/${exact + 1}`, `${Buffer.byteLength(body1)}/${Buffer.byteLength(body2)}`)
  const r1 = await req(PORT_A, "POST", "/api/entry/add", { body: body1, timeout: 12000 })
  const r2 = await req(PORT_A, "POST", "/api/entry/add", { body: body2, timeout: 12000 })
  check("A17", "body 恰好 128KB → 200；128KB+1 → 413/断连", r1.status === 200 && r2.status === 413, "200 / 413", `exact=${statusOf(r1)} over=${statusOf(r2)} body=${brief(r2.text ?? r2.error)}`)
}

// A19 update 正常（先取 id / number）
const fullEntry = await findEntry(PORT_A, FULL)
{
  const r = await req(PORT_A, "POST", "/api/entry/update", { body: { id: fullEntry.id, content: "updated full memory", category: "global", priority: "low", project: "projB", tags: "t1,t2", status: "pending", pinned: true, ttlDays: 1 } })
  const s = json(r)
  const entry = (s.entries ?? []).find((e) => e.id === fullEntry.id)
  check("A19", "POST /api/entry/update 全字段生效", r.status === 200 && entry && entry.content === "updated full memory" && entry.category === "global" && entry.priority === "low" && entry.project === "projB" && brief(entry.tags) === '["t1","t2"]' && entry.status === "pending" && entry.pinned === true && typeof entry.expiresAt === "string",
    "200 / 8 个字段全改成功", `status=${statusOf(r)} entry=${brief(entry)}`)
}

// A20 update 非法枚举 → 静默忽略
{
  const r = await req(PORT_A, "POST", "/api/entry/update", { body: { id: fullEntry.id, category: "evil", priority: "urgent", status: "weird" } })
  const entry = (json(r).entries ?? []).find((e) => e.id === fullEntry.id)
  check("A20", "update 非法 category/priority/status → 200 静默忽略（无 400）", r.status === 200 && entry?.category === "global" && entry?.priority === "low" && entry?.status === "pending",
    "200 / 保持原值", `status=${statusOf(r)} category=${entry?.category} priority=${entry?.priority} status=${entry?.status} body=${brief(r.text)}`)
}

// A21 update 超长
{
  const r = await req(PORT_A, "POST", "/api/entry/update", { body: { id: fullEntry.id, content: "x".repeat(3000) } })
  check("A21", "update content > 2048 → 400", r.status === 400, "400", `status=${statusOf(r)} body=${brief(r.text)}`)
}

// A22 update 不存在 id
{
  const r = await req(PORT_A, "POST", "/api/entry/update", { body: { id: "mem-does-not-exist", content: "x" } })
  check("A22", "update 不存在 id → 404", r.status === 404, "404", `status=${statusOf(r)} body=${brief(r.text)}`)
}

// A23 update 用 number 定位（接口额外能力）
{
  const all = json(await req(PORT_A, "GET", "/api/state")).entries ?? []
  const index = all.findIndex((e) => e.id === fullEntry.id)
  const r = await req(PORT_A, "POST", "/api/entry/update", { body: { number: index + 1, content: "updated-by-number" } })
  const entry = (json(r).entries ?? [])[index]
  check("A23", "update 支持 number 定位（文档未写明）", r.status === 200 && entry?.content === "updated-by-number", `200 + 第${index + 1}条更新`, `status=${statusOf(r)} number=${index + 1} content=${entry?.content}`)
}

// A24/A25 delete 二次确认
{
  const target = (json(await req(PORT_A, "GET", "/api/state")).entries ?? []).find((e) => e.content === "invalid enums memory")
  const r1 = await req(PORT_A, "POST", "/api/entry/delete", { body: { id: target.id } })
  const r2 = await req(PORT_A, "POST", "/api/entry/delete", { body: { id: target.id, confirm: "true" } })
  const after = await findEntry(PORT_A, "invalid enums memory")
  check("A24", "delete 不带 confirm → 409 且不删", r1.status === 409 && r2.status === 409 && Boolean(after), "409 + 条目仍在", `noConfirm=${statusOf(r1)} strConfirm=${statusOf(r2)} stillThere=${Boolean(after)} body=${brief(r1.text)}`)
}
// A26 delete 不存在
{
  const r = await req(PORT_A, "POST", "/api/entry/delete", { body: { id: "mem-nope", confirm: true } })
  check("A26", "delete 不存在 id + confirm → 404", r.status === 404, "404", `status=${statusOf(r)} body=${brief(r.text)}`)
}
// A27 delete 正常
{
  const target = await findEntry(PORT_A, "invalid enums memory")
  const before = await countEntries()
  const r = await req(PORT_A, "POST", "/api/entry/delete", { body: { id: target.id, confirm: true } })
  const after = await countEntries()
  check("A27", "delete 带 confirm → 200 且条数 -1", r.status === 200 && after === before - 1 && !(await findEntry(PORT_A, "invalid enums memory")), `${before - 1}`, `status=${statusOf(r)} before=${before} after=${after}`)
}

// A28/A29/A30 方法不匹配 / 未知路由
{
  const r1 = await req(PORT_A, "POST", "/api/state", { body: {} })
  const r2 = await req(PORT_A, "GET", "/api/entry/add")
  const r3 = await req(PORT_A, "GET", "/api/nope")
  const r4 = await req(PORT_A, "POST", "/nope", { body: {} })
  const r5 = await req(PORT_A, "PATCH", "/api/entry/add", { body: {} })
  check("A28", "POST 到 GET-only 路由 → 期望 405（实际 404）", r1.status === 405, "405", `POST /api/state=${statusOf(r1)} GET /api/entry/add=${statusOf(r2)}`)
  check("A29", "未知路由 GET/POST → 404", r3.status === 404 && r4.status === 404 && r5.status === 404, "均 404", `GET/nope=${statusOf(r3)} POST/nope=${statusOf(r4)} PATCH/add=${statusOf(r5)}`)
}

// A31 wipe（当前版本无该端点）
{
  const r = await req(PORT_A, "POST", "/api/wipe", { body: { confirm: "WIPE" } })
  const after = await countEntries()
  check("A31", "POST /api/wipe → 404（0.4.2 已无 wipe；旧 0.4.1 备份里有）", r.status === 404,
    "404（不存在）", `status=${statusOf(r)} entriesStill=${after} body=${brief(r.text)}`)
}

// A32 settings 写入 / 回显 / 白名单
{
  const payload = { injectMode: "all", maxBytes: 4096, minScore: 3, maxRelevant: 5, indexChars: 8, currentProject: "projX", showIndex: false, judgeMode: "rules", lang: "zh-TW", enabled: false, autoExtract: false, perCluster: 3, recallMaxBytes: 4096, maxRecall: 10 }
  const r = await req(PORT_A, "POST", "/api/settings", { body: payload })
  const s = json(r)
  const c = s.config ?? {}
  check("A32", "POST /api/settings 参数生效", r.status === 200 && c.injectMode === "all" && c.maxBytes === 4096 && c.minScore === 3 && c.maxRelevant === 5 && c.indexChars === 8 && c.currentProject === "projX" && c.showIndex === false && c.judgeMode === "rules",
    "config 8 项全部生效", `status=${statusOf(r)} injectMode=${c.injectMode} maxBytes=${c.maxBytes} minScore=${c.minScore} maxRelevant=${c.maxRelevant} indexChars=${c.indexChars} currentProject=${c.currentProject} showIndex=${c.showIndex} judgeMode=${c.judgeMode}`)
  check("A32b", "perCluster/recallMaxBytes/maxRecall 也被写入并生效（但不在 overrides 回显）", c.perCluster === 3 && c.recallMaxBytes === 4096 && c.maxRecall === 10,
    "3/4096/10", `${c.perCluster}/${c.recallMaxBytes}/${c.maxRecall}`)
  const overrideKeys = Object.keys(s.settings?.overrides ?? {})
  const missingOverride = ["judgeMode", "lang", "perCluster", "recallMaxBytes", "maxRecall"].filter((k) => !overrideKeys.includes(k))
  check("A32c", "settings.overrides 应回显全部已写入的用户层键（当前漏 judgeMode/lang/perCluster/recallMaxBytes/maxRecall）", missingOverride.length === 0,
    "包含全部已写入的用户层键", `overrides=${overrideKeys.join(",")} 缺少=${missingOverride.join(",") || "无"}`)
  check("A32d", "enabled=false 时 effective.enabled=false", s.settings?.enabled === false && s.effective?.enabled === false, "false/false", `${s.settings?.enabled}/${s.effective?.enabled}`)
  check("A32e", "lang=zh-TW 生效且 GET / 注入 zh-TW", s.lang === "zh-TW", "zh-TW", `lang=${s.lang}`)
  const page = await req(PORT_A, "GET", "/")
  check("A32f", "GET / 语言脚本跟随 settings.lang", String(page.text ?? "").includes('window.__DSH_MEMORY_LANG__="zh-TW"'), 'window.__DSH_MEMORY_LANG__="zh-TW"', `found=${String(page.text ?? "").includes('window.__DSH_MEMORY_LANG__="zh-TW"')}`)
}

// A32g 主开关关闭时 add 仍成功（与 UI 文案冲突）
{
  const r = await req(PORT_A, "POST", "/api/entry/add", { body: { content: "added while master switch off" } })
  const entry = (json(r).entries ?? []).find((e) => e.content === "added while master switch off")
  check("A32g", "记忆总开关关闭后 add 仍 200（UI 文案称 \"add 报错\"）", r.status !== 200 && !entry, "应拒绝写入", `status=${statusOf(r)} entryAdded=${Boolean(entry)}`)
}

// A32h 非法 settings 值（白名单校验）
{
  const before = json(await req(PORT_A, "GET", "/api/state")).config
  const r = await req(PORT_A, "POST", "/api/settings", { body: { injectMode: "evil-mode", showIndex: "yes", maxBytes: -5, maxEntries: 0, judgeMode: "bogus", lang: "xx" } })
  const c = json(r).config ?? {}
  check("A32h", "settings 应拒绝非法 injectMode/showIndex 取值（当前原样接受）", c.injectMode === "all" && c.showIndex === false,
    "保持 all / false（400 或回退默认）", `injectMode=${c.injectMode} showIndex=${c.showIndex} maxBytes=${c.maxBytes}(之前${before.maxBytes}) maxEntries=${c.maxEntries} judgeMode=${c.judgeMode} lang=${json(r).lang}`)
  check("A32h2", "settings 负数/0 数值被忽略", c.maxBytes === before.maxBytes && c.maxEntries === before.maxEntries, `保持 ${before.maxBytes}/${before.maxEntries}`, `${c.maxBytes}/${c.maxEntries}`)
}

// A32i reset
{
  const r = await req(PORT_A, "POST", "/api/settings", { body: { reset: true } })
  const s = json(r)
  const c = s.config ?? {}
  check("A32i", "reset=true 恢复注入参数默认", c.injectMode === "relevant" && c.maxBytes === 8192 && c.maxRelevant === 6 && c.minScore === 6 && c.indexChars === 18 && c.currentProject === "" && brief(s.settings?.overrides) === "{}",
    "relevant/8192/6/6/18/空/{}", `injectMode=${c.injectMode} maxBytes=${c.maxBytes} maxRelevant=${c.maxRelevant} minScore=${c.minScore} indexChars=${c.indexChars} currentProject=${c.currentProject} overrides=${brief(s.settings?.overrides)}`)
  check("A32i2", "reset 不重置 enabled/judgeMode/lang（UI 文案为 \"恢复默认\"）", s.settings?.enabled === true && c.judgeMode === "model" && s.lang === "en",
    "enabled/judgeMode/lang 也回默认", `enabled=${s.settings?.enabled} judgeMode=${c.judgeMode} lang=${s.lang}`)
  await req(PORT_A, "POST", "/api/settings", { body: { enabled: true, autoExtract: true, lang: "en", judgeMode: "model" } })
}

// A33 inbox 单条 accept（含 content/project/tags 覆盖）
{
  const alpha = await findEntry(PORT_A, "pending alpha about deploy")
  const r = await req(PORT_A, "POST", "/api/inbox", { body: { id: alpha.id, action: "accept", content: "alpha accepted edited", project: "projZ", tags: "q1", ttlDays: 2 } })
  const s = json(r)
  const entry = (s.entries ?? []).find((e) => e.id === alpha.id)
  check("A33", "inbox accept 更新 content/status", r.status === 200 && entry?.content === "alpha accepted edited" && entry?.status === "active", "200 + content 更新 + active", `status=${statusOf(r)} content=${entry?.content} statusField=${entry?.status}`)
  check("A33b", "inbox accept 应同时更新 project/tags/ttlDays（当前静默丢弃）", entry?.project === "projZ" && brief(entry?.tags) === '["q1"]' && typeof entry?.expiresAt === "string",
    "project=projZ / tags=[\"q1\"] / expiresAt 有值", `project=${entry?.project} tags=${brief(entry?.tags)} expiresAt=${entry?.expiresAt}`)
}
// A34 inbox reject
{
  const beta = await findEntry(PORT_A, "pending beta about config")
  const r = await req(PORT_A, "POST", "/api/inbox", { body: { id: beta.id, action: "reject" } })
  const entry = (json(r).entries ?? []).find((e) => e.id === beta.id)
  check("A34", "inbox reject → status=rejected", r.status === 200 && entry?.status === "rejected", "200 + rejected", `status=${statusOf(r)} statusField=${entry?.status}`)
}
// A35 inbox 不存在
{
  const r = await req(PORT_A, "POST", "/api/inbox", { body: { id: "mem-nope", action: "accept" } })
  check("A35", "inbox 不存在 id → 404", r.status === 404, "404", `status=${statusOf(r)} body=${brief(r.text)}`)
}
// A36 inbox action=edit（文档写了 edit，代码当 accept）
{
  seed([{ content: "pending edit action", status: "pending", source: "auto", project: "p" }])
  const target = await findEntry(PORT_A, "pending edit action")
  const r = await req(PORT_A, "POST", "/api/inbox", { body: { id: target.id, action: "edit", content: "edited via edit action" } })
  const entry = (json(r).entries ?? []).find((e) => e.id === target.id)
  check("A36", "inbox action=edit 应有独立语义（当前被当作 accept）", entry?.status === "pending",
    "400 或保持 pending（不能静默当成 accept）", `status=${statusOf(r)} entryStatus=${entry?.status} content=${entry?.content}`)
}
// A37/A38/A39 bulk
{
  seed([
    { content: "bulk pending 1", status: "pending", source: "auto" },
    { content: "bulk pending 2", status: "pending", source: "auto" },
    { content: "bulk pending 3", status: "pending", source: "auto" },
  ])
  const r = await req(PORT_A, "POST", "/api/inbox/bulk", { body: { action: "accept" } })
  const s = json(r)
  const entries = s.state?.entries ?? []
  const touchedOk = ["bulk pending 1", "bulk pending 2", "bulk pending 3"].every((c) => entries.find((e) => e.content === c)?.status === "active")
  check("A37", "inbox/bulk accept 全部接受 + touched 计数", r.status === 200 && s.touched === 3 && touchedOk, "touched=3 + 3 条 active", `status=${statusOf(r)} touched=${s.touched} allActive=${touchedOk}`)

  seed([
    { content: "bulk reject 1", status: "pending", source: "auto" },
    { content: "bulk reject 2", status: "pending", source: "auto" },
  ])
  const r2 = await req(PORT_A, "POST", "/api/inbox/bulk", { body: { action: "reject" } })
  const s2 = json(r2)
  const entries2 = s2.state?.entries ?? []
  const rejectedOk = ["bulk reject 1", "bulk reject 2"].every((c) => entries2.find((e) => e.content === c)?.status === "rejected")
  check("A38", "inbox/bulk reject 全部拒绝", r2.status === 200 && s2.touched === 2 && rejectedOk, "touched=2 + 2 条 rejected", `status=${statusOf(r2)} touched=${s2.touched} allRejected=${rejectedOk}`)

  seed([{ content: "bulk bogus pending", status: "pending", source: "auto" }])
  const r3 = await req(PORT_A, "POST", "/api/inbox/bulk", { body: { action: "bogus-action" } })
  const s3 = json(r3)
  const bogus = (s3.state?.entries ?? []).find((e) => e.content === "bulk bogus pending")
  check("A39", "inbox/bulk 应拒绝非法 action（当前按 accept 处理）", r3.status === 400, "400（未知 action 不执行）", `status=${statusOf(r3)} touched=${s3.touched} entryStatus=${bogus?.status}`)
}

// A40/A41 并发
{
  const before = await countEntries()
  const adds = await Promise.all(Array.from({ length: 20 }, (_, i) => req(PORT_A, "POST", "/api/entry/add", { body: { content: `concurrent unique ${RID} ${i}` }, timeout: 20000 })))
  const statuses = adds.map(statusOf)
  const ok = statuses.filter((s) => s === 200).length
  const after = await countEntries()
  const stateEntries = json(await req(PORT_A, "GET", "/api/state")).entries
  const present = stateEntries.filter((e) => String(e.content).startsWith(`concurrent unique ${RID} `)).length
  check("A40", "并发 20 条不同内容 add：全部 200 且一条不少", ok === 20 && after === before + 20 && present === 20,
    "20×200 / 条数+20 / 20 条都在", `200=${ok} statuses=${[...new Set(statuses)].join("|")} before=${before} after=${after} present=${present}`)

  const beforeDup = await countEntries()
  const dups = await Promise.all(Array.from({ length: 20 }, () => req(PORT_A, "POST", "/api/entry/add", { body: { content: `race same content ${RID}` }, timeout: 20000 })))
  const dupStatuses = dups.map(statusOf)
  const dupOk = dupStatuses.filter((s) => s === 200).length
  const dupConflict = dupStatuses.filter((s) => s === 409).length
  const afterDup = await countEntries()
  const sameCount = json(await req(PORT_A, "GET", "/api/state")).entries.filter((e) => e.content === `race same content ${RID}`).length
  check("A41", "并发 20 条相同内容：应恰好 1 条入库（1×200 + 19×409）", dupOk === 1 && dupConflict === 19 && afterDup === beforeDup + 1 && sameCount === 1,
    "1×200 / 19×409 / 库内 1 条", `200=${dupOk} 409=${dupConflict} other=${dupStatuses.filter((s) => s !== "200" && s !== "409").join("|") || "无"} before=${beforeDup} after=${afterDup} rows=${sameCount}`)
}

// A42 XSS 载荷原样存储（客户端转义责任）
{
  const payload = '<img src=x onerror=alert(1)>'
  const r = await req(PORT_A, "POST", "/api/entry/add", { body: { content: "xss probe " + payload } })
  const entry = (json(r).entries ?? []).find((e) => e.content.includes(payload))
  check("A42", "服务端原样存储 HTML 载荷（无服务端转义，UI 必须用 textContent）", Boolean(entry), "原样存储（可在 api 中看到）", `stored=${Boolean(entry)}`)
}

// A43 state 与 export 条数一致
{
  const state = json(await req(PORT_A, "GET", "/api/state"))
  const exp = json(await req(PORT_A, "GET", "/api/export"))
  check("A43", "state.entries 与 export.entries 条数一致", state.entries?.length === exp.entries?.length, String(state.entries?.length), `state=${state.entries?.length} export=${exp.entries?.length}`)
}

// A44 数据落盘与后台日志
{
  check("A44", "SQLite 库文件已创建且非空", existsSync(DATA_A) && readFileSync(DATA_A).length > 0, "存在且 >0 字节", existsSync(DATA_A) ? `${readFileSync(DATA_A).length} bytes` : "missing")
  check("A44b", "未生成 legacy JSON（迁移源不存在时）", !existsSync(LEGACY_A), "legacy 不存在", existsSync(LEGACY_A) ? "存在" : "不存在")
  const errLines = srvA.logs.filter((line) => line.includes("[stderr]") || line.includes("[exit]"))
  check("A44c", "服务端测试期间无 stderr / 异常退出", errLines.length === 0, "无", brief(errLines.join(" ")) || "无")
}

await stopServer(srvA)

// ════════════════════════════════════════════════════════════════════════
// 阶段 B：降级场景（垃圾字节数据库）
// ════════════════════════════════════════════════════════════════════════
{
  writeFileSync(DATA_B, "THIS IS NOT A SQLITE DATABASE \u0000\u0001\u0002 garbage bytes " + "A".repeat(4096), "utf8")
  const hashBefore = createHash("sha256").update(readFileSync(DATA_B)).digest("hex")
  const srvB = startServer(PORT_B, DATA_B, LEGACY_B, PATCH_B, "B")
  const ready = await waitReady(PORT_B)
  check("B0", "降级库仍能启动服务（GET /api/state 有响应）", ready, "能启动", `ready=${ready} logs=${brief(srvB.logs.join(" "))}`)
  const st = await req(PORT_B, "GET", "/api/state")
  const s = json(st)
  check("B1", "垃圾库 → degraded 有值 + 条目为空 + 页面可见", st.status === 200 && s.degraded && String(s.degraded.reason ?? "").includes("SQLite") && s.entries?.length === 0,
    "degraded.reason 含 SQLite / entries=[]", `status=${statusOf(st)} degraded=${brief(s.degraded)} entries=${s.entries?.length}`)
  const page = await req(PORT_B, "GET", "/")
  check("B2", "GET / 顶部降级横幅（记忆库异常 / 写入已禁用）", String(page.text ?? "").includes("记忆库异常") && String(page.text ?? "").includes("写入已禁用"),
    "包含横幅文案", `hasBanner=${String(page.text ?? "").includes("记忆库异常")} hasDisabled=${String(page.text ?? "").includes("写入已禁用")} bytes=${String(page.text ?? "").length}`)
  const add = await req(PORT_B, "POST", "/api/entry/add", { body: { content: "degraded add should be rejected" } })
  check("B3", "降级时 add 被拒（500 + MEMORY_DEGRADED）", add.status === 500 && String(json(add).error ?? "").includes("MEMORY_DEGRADED"),
    "500 + MEMORY_DEGRADED", `status=${statusOf(add)} body=${brief(add.text)}`)
  const del = await req(PORT_B, "POST", "/api/entry/delete", { body: { id: "whatever", confirm: true } })
  check("B3b", "降级时 delete 被拒", del.status === 500 && String(json(del).error ?? "").includes("MEMORY_DEGRADED"), "500", `status=${statusOf(del)} body=${brief(del.text)}`)
  const set = await req(PORT_B, "POST", "/api/settings", { body: { enabled: true } })
  check("B3c", "降级时 settings 写入被拒", set.status === 500 && String(json(set).error ?? "").includes("MEMORY_DEGRADED"), "500", `status=${statusOf(set)} body=${brief(set.text)}`)
  const hashAfter = createHash("sha256").update(readFileSync(DATA_B)).digest("hex")
  check("B4", "所有被拒写操作后垃圾库文件字节不变", hashBefore === hashAfter, "hash 相同", `same=${hashBefore === hashAfter}`)
  const exp = await req(PORT_B, "GET", "/api/export")
  const ejson = json(exp)
  check("B5", "降级时 export 返回空 entries 且无 degraded 标记（用户可能误以为导出完整）", exp.status === 200 && ejson.entries?.length === 0 && ejson.degraded === undefined,
    "应带 degraded 标记", `status=${statusOf(exp)} entries=${ejson.entries?.length} hasDegraded=${ejson.degraded !== undefined}`)
  // B6 先查再停：stopServer 会主动结束进程并写一条 [exit]，放在停止之后查等于必然失败。
  check("B6", "降级服务测试期间无异常退出", !srvB.logs.some((line) => line.includes("[exit]")), "无异常退出", brief(srvB.logs.join(" ")) || "无")
  await stopServer(srvB)
}

// ── 汇总 ──────────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.ok).length
console.log(`\n==== HTTP 审计结果：${passed}/${results.length} 通过 ====`)
for (const r of results) {
  const tag = r.ok ? "PASS" : "FAIL"
  console.log(`[${tag}] ${r.id} ${r.name}`)
  if (!r.ok) {
    console.log(`       期望: ${r.expected}`)
    console.log(`       实测: ${r.observed}`)
  }
}
writeFileSync(join(HERE, "http-audit-result.json"), JSON.stringify({ rid: RID, tmpA: TMP_A, tmpB: TMP_B, results }, null, 2), "utf8")
console.log(`\n结果文件：${join(HERE, "http-audit-result.json")}`)
