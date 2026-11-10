/**
 * dsh-thirdparty-memory 记忆页服务（零依赖 node:http）。
 *
 * 逻辑全部复用 core.js：插件与页面看同一份数据、用同一套选条与渲染规则。
 *
 *   GET  /                       记忆页（ui.html，改完刷新即生效）
 *   GET  /api/state?q=&session=  状态 + 全部条目 + 仪表盘
 *   POST /api/entry/add          新增条目
 *   POST /api/entry/update       修改条目（内容/分类/优先级/项目/标签/TTL/状态/置顶）
 *   POST /api/entry/delete       删除条目
 *   POST /api/inbox              收件箱审批 { id, action: accept|reject|edit, content? }
 *   POST /api/inbox/bulk         全部接受/拒绝 { action }
 *   POST /api/settings           写用户层设置（总开关、自动提取、注入参数…）
 *   POST /api/preview            预览"现在开新对话会注入什么"
 *   GET  /api/export             导出全部记忆 JSON
 *
 * 只绑回环地址；POST 只接受 application/json（挡掉表单式跨站请求）。
 */

import { execFileSync } from "node:child_process"
import { createServer } from "node:http"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  APP_ID,
  CATEGORIES,
  MAX_CONTENT_BYTES,
  PRIORITIES,
  byteLength,
  dashboard,
  defaultDataFile,
  expiresFrom,
  LANGS,
  loadStore,
  mergeConfig,
  mutateStore,
  normalizeLang,
  pluginBuildId,
  pluginVersion,
  newId,
  normalizeEntry,
  nowIso,
  parseTags,
  renderInjection,
  saveStore,
  storageInfo,
} from "./core.js"

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const HOST = process.env.MEMORY_PAGE_HOST ?? "127.5.0.1"
const PORT = Number(process.env.MEMORY_PAGE_PORT ?? 7891)
const DATA_FILE = process.env.MEMORY_DATA_FILE ?? defaultDataFile()
const LEGACY_DATA_FILE = process.env.MEMORY_LEGACY_FILE ?? join(PLUGIN_DIR, "data", "memory.json")
const UI_FILE = join(PLUGIN_DIR, "ui.html")
const DEFAULT_PROJECT = process.env.MEMORY_CURRENT_PROJECT ?? ""
const VERSION = pluginVersion()
const BUILD_ID = pluginBuildId()
const STARTED_AT = new Date().toISOString()

/** 健康信息：新进程靠它判断「占着端口的是不是本插件、是不是同一个构建」。 */
function healthPayload() {
  return {
    app: APP_ID,
    version: VERSION,
    buildId: BUILD_ID,
    pid: process.pid,
    host: HOST,
    port: PORT,
    dataFile: DATA_FILE,
    startedAt: STARTED_AT,
    uptime: Math.round(process.uptime()),
  }
}

/** 读库统一带老数据来源；迁移只在库不存在时发生一次。 */
const readStore = () => loadStore(DATA_FILE, { legacyFile: LEGACY_DATA_FILE })

console.log = ((original) => (...args) => {
  try {
    original(...args)
  } catch {
    /* 无控制台会话里忽略 */
  }
})(console.log)
console.error = ((original) => (...args) => {
  try {
    original(...args)
  } catch {
    /* 同上 */
  }
})(console.error)

// ── 配置层（cordis.patch.yml）────────────────────────────────────────────
function patchCandidates() {
  const files = []
  if (process.env.MEMORY_PATCH_FILE) files.push(process.env.MEMORY_PATCH_FILE)
  if (process.env.DSH_HOME) files.push(join(process.env.DSH_HOME, "profiles", "web", "cordis.patch.yml"))
  if (process.env.APPDATA) {
    files.push(join(process.env.APPDATA, "com.yeagoo.dsh-desktop", "harness", "profiles", "web", "cordis.patch.yml"))
  }
  if (process.env.USERPROFILE) {
    files.push(join(process.env.USERPROFILE, ".dsh", "profiles", "web", "cordis.patch.yml"))
    files.push(join(process.env.USERPROFILE, ".dsh", "profiles", "desktop", "cordis.patch.yml"))
  }
  return files
}

const PATCH_CANDIDATES = patchCandidates()

function readConfigFlags() {
  const fallback = { enabled: true, autoExtract: true, inbox: true, patchFile: PATCH_CANDIDATES[0] ?? "", found: false }
  for (const file of PATCH_CANDIDATES) {
    let text
    try {
      text = readFileSync(file, "utf8")
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/)
    const start = lines.findIndex((line) => /^\s*-\s*id:\s*thirdparty-memory\b/.test(line))
    if (start < 0) continue
    const flags = { ...fallback, patchFile: file, found: true }
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index]
      if (/^\s*-\s*id:/.test(line)) break
      const match = /^\s*(enabled|autoExtract|inbox)\s*:\s*(true|false)\b/.exec(line)
      if (match) flags[match[1]] = match[2] === "true"
    }
    return flags
  }
  return fallback
}

const BASE_CONFIG = {
  enabled: true,
  autoExtract: true,
  inbox: true,
  injectMode: "relevant",
  judgeMode: "model",
  maxBytes: 8192,
  maxEntries: 50,
  maxRelevant: 6,
  perCluster: 2,
  minScore: 6,
  showIndex: true,
  indexChars: 18,
  recallMaxBytes: 16384,
  maxRecall: 40,
  currentProject: DEFAULT_PROJECT,
  vector: true,
  vectorWeight: 1,
  vectorMinCos: 0.3,
}

/** 界面语言：settings.lang → 环境变量 → 系统区域 → zh。 */
function currentLang() {
  const store = readStore()
  const fromSettings = normalizeLang(store.settings?.lang)
  if (fromSettings.length > 0) return fromSettings
  const fromEnv = normalizeLang(process.env.MEMORY_LANG)
  if (fromEnv.length > 0) return fromEnv
  const locale = process.env.LC_ALL ?? process.env.LANG ?? ""
  const fromLocale = normalizeLang(locale)
  if (fromLocale.length > 0) return fromLocale
  try {
    const system = normalizeLang(new Intl.DateTimeFormat().resolvedOptions().locale)
    if (system.length > 0) return system
  } catch {
    /* 忽略 */
  }
  return "zh"
}

function effectiveConfig(store) {
  const flags = readConfigFlags()
  return mergeConfig({ ...BASE_CONFIG, enabled: flags.enabled, autoExtract: flags.autoExtract, inbox: flags.inbox }, store.settings)
}

// ── HTTP 工具 ───────────────────────────────────────────────────────────────
function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  })
  response.end(body)
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const type = String(request.headers["content-type"] ?? "")
    if (!type.toLowerCase().startsWith("application/json")) {
      reject(Object.assign(new Error("content-type must be application/json"), { status: 415 }))
      return
    }
    const chunks = []
    let size = 0
    request.on("data", (chunk) => {
      size += chunk.length
      if (size > 128 * 1024) {
        // v0.4.3：不要在这里 request.destroy() —— 连接被重置的话客户端只会看到
        // "fetch failed / ECONNRESET"，收不到本该返回的 413。改为拒绝并继续排空。
        reject(Object.assign(new Error("body too large"), { status: 413 }))
        request.resume()
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"))
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(Object.assign(new Error("body must be a JSON object"), { status: 400 }))
          return
        }
        resolve(parsed)
      } catch {
        reject(Object.assign(new Error("body is not valid JSON"), { status: 400 }))
      }
    })
    request.on("error", reject)
  })
}

// ── 视图 ────────────────────────────────────────────────────────────────────
function snapshot(query, sessionId) {
  const store = readStore()
  const config = effectiveConfig(store)
  const flagged = readConfigFlags()
  const rendered = renderInjection(store, { query, sessionId, config })
  const projects = [...new Set(store.entries.map((entry) => entry.project).filter(Boolean))]
  return {
    dataFile: DATA_FILE,
    storage: storageInfo(DATA_FILE, { legacyFile: LEGACY_DATA_FILE }),
    lang: currentLang(),
    langs: LANGS,
    config: {
      enabled: flagged.enabled,
      autoExtract: flagged.autoExtract,
      inbox: flagged.inbox,
      patchFile: flagged.patchFile,
      patchFound: flagged.found,
      ...config,
    },
    settings: {
      enabled: store.settings.enabled !== false,
      autoExtract: store.settings.autoExtract !== false,
      overrides: Object.fromEntries(
        ["injectMode", "maxRelevant", "minScore", "showIndex", "indexChars", "maxBytes", "maxEntries", "currentProject"]
          .filter((key) => store.settings[key] !== undefined)
          .map((key) => [key, store.settings[key]]),
      ),
    },
    effective: {
      enabled: flagged.enabled && store.settings.enabled !== false,
      autoExtract: flagged.enabled && store.settings.enabled !== false && flagged.autoExtract && store.settings.autoExtract !== false,
    },
    entries: store.entries.map((entry, offset) => ({ ...entry, number: offset + 1 })),
    degraded: store.degraded ?? null,
    numbering: (() => {
      const map = {}
      const selected = rendered.selected ?? {}
      for (const bucket of ["always", "project", "ephemeral", "matched", "rest"]) {
        for (const item of selected[bucket] ?? []) map[item.entry.id] = { number: item.number, bucket }
      }
      return map
    })(),
    dashboard: dashboard(store, { query, sessionId, config }),
    preview: { bytes: rendered.bytes, tokens: rendered.tokens, marks: rendered.marks, omitted: rendered.omitted },
    projects,
  }
}

function mutate(fn) {
  // v0.4.1：读改写必须走乐观锁。原来是 read → fn → save，写入是整表替换，
  // 和 DSH 宿主里的 remember 工具撞上就会把对方刚写的那条整条吞掉。
  return mutateStore(DATA_FILE, fn, { legacyFile: LEGACY_DATA_FILE })
}

function findEntry(store, body) {
  const id = typeof body.id === "string" ? body.id.trim() : ""
  if (id.length > 0) return store.entries.find((entry) => entry.id === id)
  const number = Number(body.number)
  if (Number.isSafeInteger(number) && number >= 1) return store.entries[number - 1]
  return undefined
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]))
}

/** v0.4.1：降级状态必须在页面上看得见，否则用户只会觉得"记忆莫名其妙变少了"。 */
function degradedBanner(degraded) {
  const detail = escapeHtml(degraded?.reason ?? "未知原因")
  const file = degraded?.dbFile ? "｜库文件：" + escapeHtml(degraded.dbFile) : ""
  return (
    '<div style="margin:0;padding:12px 16px;background:#7a1d1d;color:#fff;font:14px/1.6 system-ui,sans-serif">' +
    `⚠ 记忆库异常：${detail}${file}。当前显示的是降级快照，<b>写入已禁用</b>，请先备份再处理。</div>`
  )
}

// ── 路由 ────────────────────────────────────────────────────────────────────
async function handle(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? HOST}`)
  const route = url.pathname

  if (request.method === "GET" && (route === "/" || route === "/index.html" || route === "/ui.html")) {
    let html = "<!doctype html><meta charset=utf-8><h1>ui.html 缺失</h1><p>记忆页界面文件不在插件目录里。</p>"
    try {
      html = readFileSync(UI_FILE, "utf8")
    } catch {
      /* 保持兜底文案 */
    }
    const lang = currentLang()
    html = html.replace("<!--__LANG_SCRIPT__-->", `<script>window.__DSH_MEMORY_LANG__=${JSON.stringify(lang)};</script>`)
    const degraded = readStore().degraded
    if (degraded) html = html.replace("<body>", "<body>" + degradedBanner(degraded))
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:",
    })
    response.end(html)
    return
  }

  if (request.method === "GET" && route === "/api/health") {
    sendJson(response, 200, healthPayload())
    return
  }

  if (request.method === "GET" && route === "/api/state") {
    sendJson(response, 200, snapshot(url.searchParams.get("q") ?? "", url.searchParams.get("session") ?? ""))
    return
  }

  if (request.method === "GET" && route === "/api/export") {
    const store = readStore()
    sendJson(response, 200, { version: store.version, settings: store.settings, entries: store.entries })
    return
  }

  if (request.method === "POST" && route === "/api/preview") {
    const body = await readJsonBody(request)
    const store = readStore()
    const config = effectiveConfig(store)
    const rendered = renderInjection(store, {
      query: typeof body.q === "string" ? body.q : "",
      sessionId: typeof body.session === "string" ? body.session : "",
      config,
    })
    sendJson(response, 200, {
      text: rendered.text,
      bytes: rendered.bytes,
      tokens: rendered.tokens,
      marks: rendered.marks,
      omitted: rendered.omitted,
      maxBytes: config.maxBytes,
    })
    return
  }

  if (request.method === "POST" && route === "/api/entry/add") {
    const body = await readJsonBody(request)
    const content = typeof body.content === "string" ? body.content.trim() : ""
    if (content.length === 0) {
      sendJson(response, 400, { error: "内容不能为空" })
      return
    }
    if (byteLength(content) > MAX_CONTENT_BYTES) {
      sendJson(response, 400, { error: `内容超过 ${MAX_CONTENT_BYTES} 字节，请拆成多条` })
      return
    }
    const state = mutate((store) => {
      if (store.entries.some((entry) => entry.content === content)) return { duplicate: true }
      const stamp = nowIso()
      store.entries.push(normalizeEntry({
        id: newId(),
        content,
        category: CATEGORIES.includes(body.category) ? body.category : "general",
        project: typeof body.project === "string" ? body.project.trim() : "",
        priority: PRIORITIES.includes(body.priority) ? body.priority : "medium",
        tags: parseTags(body.tags),
        source: "user",
        status: "active",
        expiresAt: expiresFrom(body.ttlDays),
        createdAt: stamp,
        updatedAt: stamp,
      }))
      return { added: true }
    })
    if (state.duplicate) {
      sendJson(response, 409, { error: "已经有完全相同的一条记忆了" })
      return
    }
    sendJson(response, 200, snapshot("", ""))
    return
  }

  if (request.method === "POST" && route === "/api/entry/update") {
    const body = await readJsonBody(request)
    // v0.4.1：update 之前不校验长度，能把一条记忆改成超过注入预算的巨无霸。
    const nextContent = typeof body.content === "string" ? body.content.trim() : ""
    if (nextContent.length > 0 && byteLength(nextContent) > MAX_CONTENT_BYTES) {
      sendJson(response, 400, { error: `内容超过 ${MAX_CONTENT_BYTES} 字节，请拆成多条` })
      return
    }
    const outcome = mutate((store) => {
      const entry = findEntry(store, body)
      if (!entry) return { missing: true }
      if (nextContent.length > 0) entry.content = nextContent
      if (CATEGORIES.includes(body.category)) entry.category = body.category
      if (PRIORITIES.includes(body.priority)) entry.priority = body.priority
      if (["active", "pending", "rejected"].includes(body.status)) entry.status = body.status
      if (typeof body.project === "string") entry.project = body.project.trim()
      if (body.tags !== undefined) entry.tags = parseTags(body.tags)
      if (body.pinned !== undefined) entry.pinned = body.pinned === true
      if (body.ttlDays !== undefined) entry.expiresAt = expiresFrom(body.ttlDays)
      if (body.clearExpiry === true) entry.expiresAt = null
      entry.updatedAt = nowIso()
      return { entry }
    })
    if (outcome.missing) {
      sendJson(response, 404, { error: "没找到这条记忆" })
      return
    }
    sendJson(response, 200, snapshot("", ""))
    return
  }

  if (request.method === "POST" && route === "/api/entry/delete") {
    const body = await readJsonBody(request)
      // v0.4.1：CLI 的 remove 要求 confirm=true，网页接口不能比它松
      if (body.confirm !== true) {
        sendJson(response, 409, { error: "删除需要二次确认：请带上 confirm: true" })
        return
      }
    const outcome = mutate((store) => {
      const entry = findEntry(store, body)
      if (!entry) return { missing: true }
      store.entries = store.entries.filter((item) => item.id !== entry.id)
      return { removed: entry.id }
    })
    if (outcome.missing) {
      sendJson(response, 404, { error: "没找到这条记忆" })
      return
    }
    sendJson(response, 200, snapshot("", ""))
    return
  }

  if (request.method === "POST" && route === "/api/inbox") {
    const body = await readJsonBody(request)
    const outcome = mutate((store) => {
      const entry = findEntry(store, body)
      if (!entry) return { missing: true }
      const action = String(body.action ?? "accept")
      if (action === "reject") entry.status = "rejected"
      else {
        if (typeof body.content === "string" && body.content.trim().length > 0) entry.content = body.content.trim()
        if (CATEGORIES.includes(body.category)) entry.category = body.category
        if (PRIORITIES.includes(body.priority)) entry.priority = body.priority
        entry.status = "active"
      }
      entry.updatedAt = nowIso()
      return { entry }
    })
    if (outcome.missing) {
      sendJson(response, 404, { error: "没找到这条记忆" })
      return
    }
    sendJson(response, 200, snapshot("", ""))
    return
  }

  if (request.method === "POST" && route === "/api/inbox/bulk") {
    const body = await readJsonBody(request)
    const action = String(body.action ?? "accept")
    const count = mutate((store) => {
      let touched = 0
      for (const entry of store.entries) {
        if (entry.status !== "pending") continue
        entry.status = action === "reject" ? "rejected" : "active"
        entry.updatedAt = nowIso()
        touched += 1
      }
      return touched
    })
    sendJson(response, 200, { touched: count, state: snapshot("", "") })
    return
  }

  if (request.method === "POST" && route === "/api/settings") {
    const body = await readJsonBody(request)
    mutate((store) => {
      const settings = store.settings
      if (typeof body.enabled === "boolean") settings.enabled = body.enabled
      if (typeof body.autoExtract === "boolean") settings.autoExtract = body.autoExtract
      if (body.judgeMode === "model" || body.judgeMode === "rules" || body.judgeMode === "off") settings.judgeMode = body.judgeMode
      const nextLang = normalizeLang(body.lang)
      if (nextLang.length > 0) settings.lang = nextLang
      for (const key of ["injectMode", "showIndex"]) {
        if (body[key] !== undefined) settings[key] = body[key]
      }
      for (const key of ["maxRelevant", "minScore", "maxBytes", "maxEntries", "indexChars"]) {
        const value = Number(body[key])
        if (Number.isFinite(value) && value > 0) settings[key] = Math.round(value)
      }
      if (typeof body.currentProject === "string") settings.currentProject = body.currentProject.trim()
      if (body.reset === true) {
        for (const key of ["injectMode", "showIndex", "maxRelevant", "minScore", "maxBytes", "maxEntries", "indexChars", "currentProject"]) {
          delete settings[key]
        }
      }
      return null
    })
    sendJson(response, 200, snapshot("", ""))
    return
  }

  sendJson(response, 404, { error: "not found" })
}

function requestHandler(request, response) {
  handle(request, response).catch((error) => {
    if (response.headersSent) {
      response.end()
      return
    }
    sendJson(response, error?.status ?? 500, { error: String(error?.message ?? error) })
  })
}

// ── 启动：接管旧页面进程 ────────────────────────────────────────────────────
// 记忆页进程是 detached 的：DSH 退出后它还活着。插件升级后新 DSH 再启动时，
// 端口被旧进程占着（EADDRINUSE），旧代码就一直替用户服务 —— 它可能带着已经
// 修掉的并发 / 降级 / 删除确认缺陷。所以先问一句「占端口的是谁」：只有确认是
// 本插件的页面进程、且确实是旧构建时才把它换掉，别的进程一律不碰。

function sameFile(left, right) {
  const norm = (value) => String(value ?? "").replace(/\//g, "\\").toLowerCase()
  return norm(left) === norm(right)
}

async function probeJson(url, timeoutMs = 2000) {
  if (typeof fetch !== "function") return null
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

/** 老页面进程没有 /api/health，只能从 netstat 里按端口找 PID。 */
function listeningPids(port) {
  try {
    const out = execFileSync("netstat", ["-ano"], { encoding: "utf8", windowsHide: true, timeout: 5000 })
    const pids = new Set()
    for (const raw of String(out).split(/\r?\n/)) {
      const match = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i.exec(raw.trim())
      if (!match) continue
      if (Number(match[1]) !== Number(port)) continue
      const pid = Number(match[2])
      if (Number.isSafeInteger(pid) && pid > 4 && pid !== process.pid) pids.add(pid)
    }
    return [...pids]
  } catch {
    return []
  }
}

async function waitUntilFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (listeningPids(port).length === 0) return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return listeningPids(port).length === 0
}

async function freePortOrExit() {
  const base = `http://${HOST}:${PORT}`
  const health = await probeJson(base + "/api/health")
  if (health) {
    if (health.app !== APP_ID) {
      console.error(`[dsh-thirdparty-memory] ${HOST}:${PORT} 被其他程序占用（${String(health.app ?? "未知")}），本进程退出。`)
      process.exit(1)
    }
    if (health.buildId === BUILD_ID) {
      console.log(`[dsh-thirdparty-memory] 记忆页已在运行且是当前构建（${VERSION} / ${BUILD_ID}），本次启动跳过。`)
      process.exit(0)
    }
    console.log(
      `[dsh-thirdparty-memory] 发现旧构建页面进程 pid=${String(health.pid)}（${String(health.version)} / ${String(health.buildId)}），` +
        `替换为当前构建 ${VERSION} / ${BUILD_ID}。`,
    )
    try {
      process.kill(Number(health.pid))
    } catch {
      /* 可能刚好自己退出了 */
    }
    if (!(await waitUntilFree(PORT, 3000))) {
      console.error(`[dsh-thirdparty-memory] 旧页面进程 pid=${String(health.pid)} 没有退出，请手动结束后重启 DSH。`)
      process.exit(1)
    }
    return
  }

  const state = await probeJson(base + "/api/state")
  if (!state) return // 端口空着，或占用者不是本插件：交给下面的 listen 处理
  if (!Array.isArray(state.entries) || !sameFile(state.dataFile, DATA_FILE)) {
    console.error(`[dsh-thirdparty-memory] ${HOST}:${PORT} 被一个不认识的服务占用，本进程退出。`)
    process.exit(1)
  }
  const pids = listeningPids(PORT)
  if (pids.length === 0) {
    console.error(`[dsh-thirdparty-memory] 端口 ${PORT} 被旧版页面进程占用，但定位不到 PID，请手动结束后重启 DSH。`)
    process.exit(1)
  }
  for (const pid of pids) {
    console.log(
      `[dsh-thirdparty-memory] 旧版页面进程（没有 health 接口）pid=${pid} 占着 ${PORT}，` +
        `替换为当前构建 ${VERSION} / ${BUILD_ID}。`,
    )
    try {
      process.kill(pid)
    } catch {
      /* 同上 */
    }
  }
  if (!(await waitUntilFree(PORT, 3000))) {
    console.error(`[dsh-thirdparty-memory] 端口 ${PORT} 仍被占用，请手动结束后重启 DSH。`)
    process.exit(1)
  }
}

async function boot() {
  await freePortOrExit()
  // 除主地址外也监听 127.0.0.1，习惯用 localhost 也能开。
  for (const also of String(process.env.MEMORY_PAGE_ALSO ?? "127.0.0.1").split(",")) {
    const extraHost = also.trim()
    if (extraHost.length === 0 || extraHost === HOST) continue
    const extra = createServer(requestHandler)
    extra.on("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        console.log(`[dsh-thirdparty-memory] ${extraHost}:${PORT} 已被占用，跳过附加地址。`)
        return
      }
      console.error(`[dsh-thirdparty-memory] 附加地址 ${extraHost}:${PORT} 启动失败：${String(error?.message ?? error)}`)
    })
    extra.listen(PORT, extraHost, () => console.log(`[dsh-thirdparty-memory] 记忆页（附加）：http://${extraHost}:${PORT}/`))
  }

  const server = createServer(requestHandler)
  server.on("error", (error) => {
    if (error?.code === "EADDRINUSE") {
      console.log(`[dsh-thirdparty-memory] ${HOST}:${PORT} 已被占用，本次启动跳过。`)
      process.exit(0)
    }
    console.error(`[dsh-thirdparty-memory] 记忆页启动失败：${String(error?.message ?? error)}`)
    process.exit(1)
  })
  server.listen(PORT, HOST, () => {
    console.log(`[dsh-thirdparty-memory] 记忆页：http://${HOST}:${PORT}/（${VERSION} / ${BUILD_ID}）`)
    console.log(`[dsh-thirdparty-memory] 数据文件：${DATA_FILE}`)
  })
}

boot()