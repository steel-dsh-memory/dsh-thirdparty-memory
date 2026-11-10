// 只读静态审查 ui.html：按钮/表单接线、端点存在性、i18n 缺键、innerHTML/转义、响应式。
// 运行：<DSH_NODE> F:\deepseek\长期记忆\tests\static-audit.mjs
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN = dirname(HERE)
const UI = join(PLUGIN, "ui.html")
const SERVER = join(PLUGIN, "server.js")
const html = readFileSync(UI, "utf8")
const server = readFileSync(SERVER, "utf8")
const out = []
const add = (id, ok, title, expected, observed) => out.push({ id, ok, title, expected, observed })

// ── 1. 提取 DICT（ui.html 里是纯对象字面量）───────────────────────────────
const dictStart = html.indexOf("const DICT = {")
const dictEnd = html.indexOf("\nlet LANG", dictStart)
const dictText = html.slice(dictStart + "const DICT = ".length, dictEnd).trim()
let DICT
try {
  DICT = new Function("return (" + dictText + ")")()
} catch (error) {
  console.error("DICT 解析失败:", error.message)
  process.exit(1)
}
const dictKeys = Object.keys(DICT)
const LANGS = ["en", "zh-CN", "zh-TW"]

// ── 2. data-i18n 键 vs DICT ───────────────────────────────────────────────
const attrKeys = [...html.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)].map((m) => m[1])
const attrMissing = [...new Set(attrKeys)].filter((key) => !DICT[key])
add("S1", attrMissing.length === 0, "所有 data-i18n / data-i18n-ph 键都在 DICT 中", "无缺键", attrMissing.length ? "缺: " + attrMissing.join(", ") : "无")

// ── 3. t("literal") 键 vs DICT ───────────────────────────────────────────
const literalKeys = [...html.matchAll(/\bt\("([^"]+)"/g)].map((m) => m[1]).filter((k) => !k.endsWith(".") && !k.includes("+"))
const literalMissing = [...new Set(literalKeys)].filter((key) => !DICT[key])
add("S2", literalMissing.length === 0, "所有 t(\"literal\") 键都在 DICT 中", "无缺键", literalMissing.length ? "缺: " + literalMissing.join(", ") : "无")

// ── 4. 三语完整性 / 空值 ─────────────────────────────────────────────────
const emptyValues = []
const missingLang = []
for (const key of dictKeys) {
  for (const lang of LANGS) {
    const value = DICT[key]?.[lang]
    if (typeof value !== "string") missingLang.push(`${key}[${lang}]`)
    else if (value.trim().length === 0) emptyValues.push(`${key}[${lang}]`)
  }
}
add("S3", missingLang.length === 0, "每个 DICT 条目都有 en/zh-CN/zh-TW 三语", "三语齐全", missingLang.length ? "缺: " + missingLang.join(", ") : "无")
add("S4", emptyValues.length === 0, "三语无空字符串", "无空值", emptyValues.length ? "空: " + emptyValues.join(", ") : "无")

// ── 5. 动态拼键是否都有对应 DICT ────────────────────────────────────────
const dynamicChecks = []
for (const category of ["global", "project", "persona", "ephemeral", "general"]) dynamicChecks.push(["cat." + category, Boolean(DICT["cat." + category])])
for (const priority of ["high", "medium", "low"]) dynamicChecks.push(["prio." + priority, Boolean(DICT["prio." + priority])])
for (const source of ["auto", "user", "agent"]) dynamicChecks.push(["src." + source, Boolean(DICT["src." + source])])
const dynamicMissing = dynamicChecks.filter(([, ok]) => !ok).map(([k]) => k)
add("S5", dynamicMissing.length === 0, "代码动态拼接的 cat./prio./src. 键都存在", "无缺键", dynamicMissing.length ? "缺: " + dynamicMissing.join(", ") : "无")

// ── 6. DICT 里从未使用的键（死文案）─────────────────────────────────────
// 注意：successKey 这类字符串是间接传进 t() 的，所以把页面里所有 "前缀.键" 形态的字符串都算作使用。
const quotedKeys = new Set([...html.matchAll(/"((?:toast|cat|prio|src|status|meta|inj|dash|chips)\.[A-Za-z0-9]+)"/g)].map((m) => m[1]))
const usedKeys = new Set([...attrKeys, ...literalKeys, ...quotedKeys])
const dynamicPrefix = (k) => k.startsWith("cat.") || k.startsWith("prio.") || k.startsWith("src.") || k.startsWith("status.")
const unused = dictKeys.filter((key) => !usedKeys.has(key) && !dynamicPrefix(key))
add("S6", unused.length === 0, "DICT 无未被引用的死键", "无死键", unused.length ? "未用: " + unused.join(", ") : "无")

// ── 7. 交互元素 vs 事件绑定 ─────────────────────────────────────────────
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])
const duplicateIds = ids.filter((id, i) => ids.indexOf(id) !== i)
add("S7", duplicateIds.length === 0, "HTML 无重复 id", "无重复", duplicateIds.length ? "重复: " + [...new Set(duplicateIds)].join(", ") : "无")

const bindings = new Set([...html.matchAll(/\$\("([^"]+)"\)\.(?:onclick|onchange|oninput|onkeydown)\s*=/g)].map((m) => m[1]))
const delegated = new Set(["q", "toast", "drawer", "modal", "modal-text", "modal-stat", "modal-close", "drawer-close", "drawer-title", "drawer-id", "dw-content", "dw-category", "dw-priority", "dw-project", "dw-ttl", "dw-tags", "dw-facts", "dw-pending", "dw-save", "dw-accept", "dw-delete", "dw-copy", "btn-add", "btn-preview", "btn-export", "btn-save-settings", "btn-reset-settings", "inbox-accept-all", "inbox-reject-all", "set-enabled", "set-autoextract", "set-showindex", "set-judge", "set-lang", "set-mode", "set-maxbytes", "set-minscore", "set-maxrelevant", "set-indexchars", "set-project", "set-inbox-flag", "set-file", "count-all", "count-inbox", "foot-state", "foot-file", "chips", "list-hub", "empty-hub", "list-inbox", "empty-inbox", "bar", "legend", "kpis", "kpis-injected", "dash-notice", "list-search", "empty-search", "search-hint", "view-hub", "view-inbox", "view-dashboard", "view-search", "view-settings"])
const interactiveIds = []
for (const match of html.matchAll(/<(button|input|select|textarea)\b[^>]*\bid="([^"]+)"/g)) interactiveIds.push(match[2])
// 表单控件可以由保存按钮统一读取（$("id")），不一定单独挂监听，两种都算"接线"。
const referenced = new Set([...html.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]))
const unbound = interactiveIds.filter((id) => !referenced.has(id))
add("S8", unbound.length === 0, "所有带 id 的 button/input/select/textarea 都被脚本引用（直接监听或保存时读取）", "无孤立控件", unbound.length ? "未接线: " + unbound.join(", ") : "无")

// nav 按钮通过循环绑定（没有 id）
const navButtons = [...html.matchAll(/<button[^>]*data-view="([^"]+)"/g)].map((m) => m[1])
const hasNavLoop = /querySelectorAll\("\.nav button"\)[^\n]*onclick/.test(html)
add("S9", navButtons.length === 5 && hasNavLoop, "5 个导航按钮由循环统一绑定", "5 个 + 循环绑定", `data-view=${navButtons.join(",")} loop=${hasNavLoop}`)

// 每个 data-view 都有对应 section
const sections = [...html.matchAll(/id="view-([a-z]+)"/g)].map((m) => m[1])
const missingSections = navButtons.filter((view) => !sections.includes(view))
add("S10", missingSections.length === 0, "每个导航视图都有对应 section", "全部存在", missingSections.length ? "缺: " + missingSections.join(", ") : sections.join(","))

// ── 8. 端点存在性 ───────────────────────────────────────────────────────
const uiEndpoints = [...new Set([...html.matchAll(/api\("(\/api\/[a-z/]+)"/g)].map((m) => m[1]))]
const serverRoutes = new Set()
for (const match of server.matchAll(/route === "(\/[^"]*)"/g)) serverRoutes.add(match[1])
const missingEndpoints = uiEndpoints.filter((path) => !serverRoutes.has(path))
add("S11", missingEndpoints.length === 0, "ui.html 调用的每个端点都在 server.js 中注册", "全部存在", missingEndpoints.length ? "缺: " + missingEndpoints.join(", ") : uiEndpoints.join(", "))

// ── 9. 记忆内容插入路径（XSS）──────────────────────────────────────────
const innerHtmlLines = [...html.matchAll(/^.*innerHTML.*$/gm)].map((m) => m[0].trim())
const contentInsertLines = [...html.matchAll(/^.*(?:content|project|tag|entry\.[a-zA-Z]+)[^\n]*\.(?:textContent|innerHTML)/gm)].map((m) => m[0].trim())
add("S12", innerHtmlLines.every((line) => !/entry\.content|entry\.project|entry\.tags|entry\.category/.test(line)), "innerHTML 拼接中不含记忆字段（记忆内容走 textContent）", "innerHTML 不插入 entry.* 内容", innerHtmlLines.length ? innerHtmlLines.join(" || ") : "无 innerHTML")
const textContentInsert = /content\.textContent = entry\.content/.test(html) && /span\.textContent = tag/.test(html)
add("S13", textContentInsert, "记忆正文与标签用 textContent 插入", "textContent", `content.textContent=${/content\.textContent = entry\.content/.test(html)} tag.textContent=${/span\.textContent = tag/.test(html)}`)
add("S14", html.includes("script-src 'unsafe-inline'") === false && server.includes("script-src 'unsafe-inline'"), "CSP 由服务端下发且允许内联脚本（HTML 自身无 CSP）", "服务端 CSP", `serverCSP=${/script-src 'unsafe-inline'/.test(server)} htmlCSPmeta=${/http-equiv="Content-Security-Policy"/.test(html)}`)

// ── 10. 响应式 ──────────────────────────────────────────────────────────
const mediaQueries = [...html.matchAll(/@media\s*([^{]+)\{/g)].map((m) => m[1].trim())
const layoutMedia = mediaQueries.filter((q) => !q.includes("prefers-color-scheme"))
add("S15", layoutMedia.length > 0, "存在窄屏/移动端响应式断点", "至少一个屏幕宽度断点", `@media = ${mediaQueries.join(" | ") || "无"}`)
add("S16", /body\s*\{[^}]*overflow-x|\.app[^}]*grid-template-columns:224px/.test(html) === false || layoutMedia.length > 0, "224px 固定侧栏 + minmax(0,1fr) 在窄屏下需要断点", "有断点", `layoutMedia=${layoutMedia.length} grid=${/grid-template-columns:224px minmax\(0,1fr\)/.test(html)}`)

// ── 11. 轮询覆盖用户未保存输入 ──────────────────────────────────────────
const pollLine = (html.match(/setInterval\([^\n]*6000[^\n]*\)/) ?? [""])[0]
const pollGuardsInput = /activeElement|dirty|editing/.test(pollLine)
add("S17", pollGuardsInput, "6 秒轮询检查了输入焦点/未保存状态（当前会重渲染 settings 表单并覆盖未保存输入）", "轮询应避开正在编辑的 settings 表单", pollLine)

// ── 12. 导出按钮错误处理 ────────────────────────────────────────────────
const exportBlock = html.slice(html.indexOf('$("btn-export").onclick'), html.indexOf('LANG = LANGS.includes'))
add("S18", /try\s*\{/.test(exportBlock), "导出按钮 fetch 失败时有提示（try/catch 或 toast）", "有错误处理", exportBlock.split("\n").slice(0, 12).join(" "))

// ── 13. reset 按钮语义 vs 服务端 ────────────────────────────────────────
add("S19", /reset: true/.test(html), "页面 Reset 走 /api/settings {reset:true}", "存在", `reset=${/reset: true/.test(html)}`)

// ── 14. 设置保存空数字 ──────────────────────────────────────────────────
const saveBlock = html.slice(html.indexOf('$("btn-save-settings").onclick'), html.indexOf('$("btn-reset-settings").onclick'))
add("S20", /\.value\.trim\(\)|Number\.isFinite|parseInt/.test(saveBlock), "Save 前校验数字输入（空输入 Number(\"\")=0 被服务端忽略，toast 仍报已保存）", "空/非法数字应有提示", saveBlock.split("\n").slice(0, 10).join(" "))

// ── 15. 抽屉 Accept 载荷含服务端不处理的字段 ────────────────────────────
const acceptBlock = html.slice(html.indexOf('$("dw-accept").onclick'), html.indexOf('$("dw-delete").onclick'))
const inboxBlock = server.slice(server.indexOf('route === "/api/inbox"'), server.indexOf('route === "/api/inbox/bulk"'))
add("S21", /body\.project|body\.tags|body\.ttlDays/.test(inboxBlock), "Accept 发送的 project/tags/ttlDays 在 /api/inbox 中被处理", "两端字段一致", `acceptUsesDrawerPayload=${/drawerPayload\(\)/.test(acceptBlock)} inboxHandlesProject=${/body\.project/.test(inboxBlock)} inboxHandlesTags=${/body\.tags/.test(inboxBlock)}`)

// ── 16. 状态/原文显示 ───────────────────────────────────────────────────
add("S22", /status\.archived/.test(dictText), "UI 为 archived 状态提供标签（当前归档条目看起来和普通记忆一样）", "有 status.archived 文案/标签", `hasArchivedDict=${/status\.archived/.test(dictText)}`)
add("S23", /t\("status\."\s*\+\s*entry\.status\)|t\("status\."\s*\+/.test(html), "抽屉里 status 走 i18n（当前直接拼英文原值 active/pending/rejected）", "t(\"status.\"+status)", `rawStatus=${/t\("meta\.status"\) \+ " " \+ entry\.status/.test(html)}`)

// ── 17. chips 计数与列表过滤口径 ─────────────────────────────────────────
add("S24", !(/counts\[entry\.category\]/.test(readFileSync(join(PLUGIN, "core.js"), "utf8")) && /entry\.status !== "pending"/.test(html)), "分类 chip 计数与列表过滤口径一致（计数含 pending，列表排除 pending）", "同口径", `countsAllCategories=${/counts\[entry\.category\]/.test(readFileSync(join(PLUGIN, "core.js"), "utf8"))} filterExcludesPending=${/entry\.status !== "pending"/.test(html)}`)

// ── 18. 移动端抽屉/弹窗宽度 ─────────────────────────────────────────────
add("S25", /width:min\(480px,92vw\)/.test(html) && /width:min\(760px,96vw\)/.test(html), "抽屉/弹窗本身用了 vw 上限（窄屏可用）", "vw 上限", `drawer=${/width:min\(480px,92vw\)/.test(html)} modal=${/width:min\(760px,96vw\)/.test(html)}`)

// ── 19. UI 暴露但核心代码真正消费的配置项 ────────────────────────────────
const coreText = readFileSync(join(PLUGIN, "core.js"), "utf8")
const injectModeUses = (coreText.match(/injectMode/g) ?? []).length
const maxEntriesUses = (coreText.match(/maxEntries/g) ?? []).length
add("S26", injectModeUses > 1, "设置里的 injectMode（relevant/all）真正影响注入选条", "injectMode 在选条逻辑中被消费", `core.js 中 injectMode 出现 ${injectModeUses} 次（仅出现在 OVERRIDABLE_CONFIG_KEYS 白名单里，未被任何选择逻辑读取）`)
add("S27", maxEntriesUses > 1, "maxEntries 真正影响注入条目数", "maxEntries 被消费", `core.js 中 maxEntries 出现 ${maxEntriesUses} 次（仅白名单）`)

const passed = out.filter((r) => r.ok).length
console.log(`\n==== ui.html 静态审查：${passed}/${out.length} 通过 ====`)
for (const r of out) {
  console.log(`[${r.ok ? "PASS" : "FAIL"}] ${r.id} ${r.title}`)
  if (!r.ok) {
    console.log(`       期望: ${r.expected}`)
    console.log(`       实测: ${r.observed}`)
  }
}
console.log(`\nDICT 条目数=${dictKeys.length}  data-i18n 引用=${new Set(attrKeys).size}  t() 字面量=${new Set(literalKeys).size}  ui 端点=${uiEndpoints.join(",")}`)
