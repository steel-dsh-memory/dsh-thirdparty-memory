/**
 * dsh-thirdparty-memory — 第三方开源长期记忆插件 for DeepSeek Harness (DSH)（非官方 / unofficial）。
 *
 * 这一层只做 cordis 胶水：系统提示词注入、remember 工具、会话事件监听、
 * 记忆页进程拉起。数据模型 / 选条 / 渲染 / 提取规则都在 core.js（与记忆页共用）。
 *
 * 记忆分五类：
 *   global    全局/常驻   每轮必注入
 *   persona   用户画像    每轮必注入（自动提取的性格/兴趣/个性）
 *   project   工作区/项目  只在提到该项目时激活，否则休眠
 *   ephemeral 临时/易失    只在同一会话内有效
 *   general   普通        按关键词相关性挑
 *
 * MIT License.
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { defineTool } from "@deepseek-ai/dsh-tools"
import {
  CATEGORIES,
  MAX_CONTENT_BYTES,
  PRIORITIES,
  autoWriteStatus,
  byteLength,
  dashboard,
  defaultDataFile,
  entriesForAllMode,
  expiresFrom,
  extractCandidates,
  loadStore,
  mergeConfig,
  mutateStore,
  newId,
  normalizeEntry,
  nowIso,
  renderInjection,
} from "./core.js"

export const name = "dsh-thirdparty-memory"

/** Cordis services this plugin reads from the context. */
export const inject = ["tools", "systemPrompt"]

/**
 * 零依赖的 Standard Schema（`~standard`）配置校验。
 *
 * 为什么不用 @deepseek-ai/schemastery：插件要同时兼容 DSH 桌面 MSIX（0.2.15）、
 * 便携 Electron 版（0.2.1-rc.3）以及 CLI 版，而这些发行线自带的 schemastery
 * 版本可能不同。cordis 只要求 `Config["~standard"].validate(config)` 同步返回
 * `{ value }` 或 `{ issues }`，所以这里自己实现足够，插件从此不绑宿主版本。
 */
function buildConfig(fields) {
  const validate = (input) => {
    const source = input !== null && typeof input === "object" && !Array.isArray(input) ? input : {}
    const value = {}
    const issues = []
    for (const [key, spec] of Object.entries(fields)) {
      const raw = source[key]
      if (raw === undefined || raw === null || raw === "") {
        value[key] = spec.type === "string" ? spec.fallback : spec.fallback
        continue
      }
      if (spec.type === "boolean") {
        if (typeof raw === "boolean") value[key] = raw
        else if (raw === "true" || raw === "false") value[key] = raw === "true"
        else issues.push({ message: key + " 必须是布尔值", path: [key] })
        continue
      }
      if (spec.type === "number") {
        const number = Number(raw)
        if (!Number.isFinite(number)) {
          issues.push({ message: key + " 必须是数字", path: [key] })
          continue
        }
        let next = spec.integer === false ? number : Math.round(number)
        if (spec.min !== undefined) next = Math.max(spec.min, next)
        if (spec.max !== undefined) next = Math.min(spec.max, next)
        value[key] = next
        continue
      }
      if (typeof raw === "string") value[key] = raw
      else issues.push({ message: key + " 必须是字符串", path: [key] })
    }
    return issues.length > 0 ? { issues } : { value }
  }
  const Config = (input) => {
    const result = validate(input)
    if (result.issues) throw new TypeError(result.issues.map((issue) => issue.message).join("; "))
    return result.value
  }
  Config["~standard"] = { version: 1, vendor: "dsh-thirdparty-memory", validate }
  return Config
}

const bool = (fallback) => ({ type: "boolean", fallback })
const text = (fallback) => ({ type: "string", fallback })
const num = (fallback, extra = {}) => ({ type: "number", fallback, ...extra })

export const Config = buildConfig({
  enabled: bool(true),
  dataFile: text(""),
  maxBytes: num(8192, { min: 1 }),
  maxEntries: num(50, { min: 1 }),
  autoExtract: bool(true),
  inbox: bool(true),
  injectMode: text("relevant"),
  maxRelevant: num(6, { min: 1 }),
  perCluster: num(2, { min: 1 }),
  recallMaxBytes: num(16384, { min: 1 }),
  maxRecall: num(40, { min: 1 }),
  minScore: num(6, { min: 0 }),
  showIndex: bool(true),
  indexChars: num(18, { min: 1 }),
  currentProject: text(""),
  pageServer: bool(true),
  pageHost: text("127.5.0.1"),
  pagePort: num(7891, { min: 1, max: 65535 }),
  // 向量层：默认本地零依赖（哈希 n-gram + 余弦）；关掉就是纯关键词。
  vector: bool(true),
  vectorWeight: num(1, { min: 0 }),
  vectorMinCos: num(0.3, { min: 0, max: 1 }),
})
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
/**
 * 老版本把数据放在插件目录里 —— 那正是更新时会被替换的位置。
 * 现在它只作「只读迁移来源」：复制进新库，原文件一个字节都不动。
 */
const LEGACY_DATA_FILE = join(PLUGIN_DIR, "data", "memory.json")

export function apply(ctx, config) {
  const dataFile = config.dataFile && config.dataFile.trim().length > 0 ? config.dataFile.trim() : defaultDataFile()

  const read = () => loadStore(dataFile, { legacyFile: LEGACY_DATA_FILE })
  /** 读改写一律走 mutate：写入是整表替换，直接 save 会吞掉别的进程刚写进来的条目。 */
  const mutate = (mutator) => mutateStore(dataFile, mutator, { legacyFile: LEGACY_DATA_FILE })

  /** 生效开关 = 配置层 AND 记忆页用户层。 */
  function effectiveFlags(store) {
    const settings = store?.settings ?? {}
    const enabled = config.enabled && settings.enabled !== false
    const autoExtract = enabled && config.autoExtract && settings.autoExtract !== false
    return { enabled, autoExtract }
  }

  /**
   * 最近一条用户消息 + 当前会话 id（注入回调拿不到，只能从事件缓存）。
   *
   * v0.4.3：以前这两个是全局单值，子代理 / 其他会话发一条消息就会把主会话的
   * 「本轮提问」顶掉 —— 注入段于是按别人的问题选条（实测：主会话问插件 bug，
   * 子代理一条「大连沙盘」任务进来后，主会话立刻改选沙盘记忆）。
   * 现在按 session id 各存一份；注入时优先用 assembly 的 scope（= agent，
   * 带 .session.id）去取，取不到才退回「最近一次顶层会话」。
   */
  const lastBySession = new Map()
  let lastUserText = ""
  let currentSessionId = ""
  function noteTurn(text, sessionId, topLevel = true) {
    const value = typeof text === "string" ? text.trim() : ""
    if (value.length === 0) return
    if (typeof sessionId === "string" && sessionId.length > 0) {
      lastBySession.set(sessionId, value)
      if (lastBySession.size > 64) lastBySession.delete(lastBySession.keys().next().value)
      currentSessionId = sessionId
    }
    // 全局兜底只吃顶层会话：子代理的 prompt 不该成为主会话的检索词。
    if (topLevel) lastUserText = value
  }
  function isTopLevelSession(session) {
    const header = session?.header ?? {}
    if (header.origin === "subagent") return false
    return !(Number(header.delegationDepth ?? 0) > 0)
  }
  /** 注入时定位「本轮提问」：优先按 assembly 的 scope（agent.session.id）。 */
  function turnContext(assembleContext) {
    const scopeSessionId = String(assembleContext?.scope?.session?.id ?? "")
    const query = lastBySession.get(scopeSessionId) ?? lastUserText
    return { query, sessionId: scopeSessionId || currentSessionId }
  }

  /** 预览过的删除（编号 → 那次预览到的 id），防止两次调用之间编号位移删错条目。 */
  const pendingRemovals = new Map()

  /** 按 id 或 1 起的编号定位（编号与 list / 注入段 / 记忆页一致）。 */
  function resolveTarget(store, args) {
    const id = typeof args.id === "string" ? args.id.trim() : ""
    if (id.length > 0) return store.entries.find((entry) => entry.id === id)
    const index = Number(args.index)
    if (!Number.isSafeInteger(index) || index < 1) return undefined
    return store.entries[index - 1]
  }

  /**
   * 自动提取落盘：画像进 persona。
   * v0.4.4（#23）：状态不再由这里的 scope 判断，统一交给 core.autoWriteStatus ——
   * 收件箱开（默认）时**所有**自动写入都是 pending，只有 inbox: false 才直接 active。
   * remember 工具（agent 显式调用）不走这条路径，仍然直接生效。
   */
  function captureAuto(text) {
    const candidates = extractCandidates(text)
    if (candidates.length === 0) return
    try {
      mutate((store) => {
        if (!effectiveFlags(store).autoExtract) return { __skipWrite: true }
        let added = 0
        for (const candidate of candidates) {
          const isProfile = candidate.scope === "profile"
          if (store.entries.some((entry) => entry.content === candidate.content)) continue
          const stamp = nowIso()
          store.entries.push(
            normalizeEntry({
              id: newId(),
              content: candidate.content,
              category: isProfile ? "persona" : "general",
              priority: "medium",
              tags: [],
              source: "auto",
              status: autoWriteStatus(candidate, config),
              expiresAt: null,
              sessionId: "",
              createdAt: stamp,
              updatedAt: stamp,
            }),
          )
          added += 1
        }
        return added > 0 ? { added } : { __skipWrite: true }
      })
    } catch (error) {
      ctx.logger?.warn?.(`dsh-thirdparty-memory: 自动记忆写入失败: ${String(error)}`)
    }
  }

  // ── 记忆页进程 ────────────────────────────────────────────────────────────
  function startPageServer() {
    if (!config.pageServer) return
    const pageScript = join(PLUGIN_DIR, "server.js")
    if (!existsSync(pageScript)) return
    try {
      const child = spawn(process.execPath, [pageScript], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        cwd: PLUGIN_DIR,
        env: {
          ...process.env,
          MEMORY_PAGE_HOST: config.pageHost,
          MEMORY_PAGE_PORT: String(config.pagePort),
          MEMORY_DATA_FILE: dataFile,
          MEMORY_CURRENT_PROJECT: config.currentProject,
        },
      })
      child.on("error", (error) => ctx.logger?.warn?.(`dsh-thirdparty-memory: 记忆页启动失败: ${String(error)}`))
      child.unref()
    } catch (error) {
      ctx.logger?.warn?.(`dsh-thirdparty-memory: 记忆页启动失败: ${String(error)}`)
    }
  }
  startPageServer()

  // ── 系统提示词：静态指令段 ────────────────────────────────────────────────
  ctx.systemPrompt.section({
    name: "tool:remember",
    order: 100,
    text:
      "你有跨会话的长期记忆（remember 工具 + 系统提示词里的【长期记忆】段）。" +
      "记忆分五类：全局/常驻（每轮必带）、用户画像（每轮必带）、项目（只在提到该项目时激活）、临时（仅本会话）、一般（按关键词选）。" +
      "用户明确说\"记住 / 记一下 / 别忘了 / 帮我记着\"时，用 remember action=add 记下来；" +
      "项目相关的记忆 add 时带 action=add 的 category=project + project=<项目名>，" +
      "要每轮都遵守的写成 category=global，一次性上下文用 category=ephemeral。" +
      "用户没说记住时，系统只会把关于用户本人的画像自动记进\"收件箱\"待审批，技术任务不会被自动记住。" +
      "【自主记经验】你在干活过程中踩了坑、或总结出可复用的经验/教训（例如\"这个接口分页参数是 1 起\"\"这种报错其实是编码问题\"），" +
      "可以不经过用户同意直接 remember action=add 记下来，事后再一句话告知用户即可；这类条目 tags 建议带上\"经验\"或\"踩坑\"，" +
      "项目相关的带 category=project + project=<项目名>。" +
      "【画像怎么写】写 category=persona 的条目时，内容必须同时具备四个特征：①带日期（这条观察是哪天得到的）；" +
      "②有场景（指认到底发生了什么，而不是他是什么样的人）；③有锚点（保留他的原话或一个明确动作，不要转述）；" +
      "④至多一句解读，且放在最后（结构：日期 + 场景 + 原话/动作 + 一句解读）。" +
      "只有形容词和结论、没有日期和场景的条目不写——那是给人建档，不是记录事实，会让用户不适。" +
      "想不起场景和原话就不要写；不确定他是否表示过，就不要写成他的观点。" +
      "过时或错误的记忆用 action=update 修正、action=remove 删除。" +
      "注入段是按规则挑出来的条目，其余只给编号索引：需要全文就 remember read <编号>，别凭标题猜。" +
      "一句话里提到多个东西时，注入段会为每个话题各带几条；" +
      "用户如果要某个主题的全部记忆（例如\"提取关于某个主题的全部记忆\"），会自动放开相关度门槛整批给出，" +
      "遇到这种请求你也可以直接用 remember search <主题> 补齐。" +
      "用户问\"记忆里有什么\"\"第一条是什么\"时，直接照【长期记忆】段或 remember list 的编号回答，" +
      "不要为了找记忆去搜索插件目录、源码或 data/memory.json 的位置。" +
      "不要记录一次性的临时状态、会话日志或可由代码/配置直接读到的内容。",
  })

  // ── 系统提示词：动态记忆上下文 ────────────────────────────────────────────
  ctx.systemPrompt.context({
    name: "memory:thirdparty",
    order: 95,
    text: (assembleContext) => {
      const store = read()
      if (!effectiveFlags(store).enabled) return ""
      // 记忆页里调的参数写在 settings，这里合并进配置层（白名单键）。
      const effectiveConfig = mergeConfig(config, store.settings)
      // v0.4.3：按本次 assembly 所属会话取「本轮提问」，不再用全进程共享的单值。
      const { query, sessionId } = turnContext(assembleContext)
      if (String(effectiveConfig.injectMode) === "all") {
        const forced = { ...effectiveConfig, minScore: 0, maxRelevant: effectiveConfig.maxEntries }
        // v0.4.4（#12）：其它会话的 ephemeral 不得跟着 all 模式泄漏进来；
        // 本会话的 ephemeral 保持原类别（不再改写成 general）并进正文。
        return renderInjection(entriesForAllMode(store, sessionId), { query, sessionId, config: forced }).text
      }
      return renderInjection(store, { query, sessionId, config: effectiveConfig }).text
    },
  })

  // ── remember 工具 ─────────────────────────────────────────────────────────
  ctx.tools.register(
    defineTool({
      name: "remember",
      description:
        "维护跨会话长期记忆（本地 SQLite，宿主没有 node:sqlite 时自动回退 JSON；自动注入后续会话的系统提示词）。" +
        "action=list 列出全部（带 1 起编号与类别/优先级/状态）；read 取一条全文；" +
        "add 新增（可带 category=global|persona|project|ephemeral|general、priority、project、ttlDays）；" +
        "update 改内容/分类/优先级/状态/项目/TTL；remove 按 id 或编号删除（需要二次确认：第一次只回显，第二次带 confirm=true 才真删）；search 按关键词搜索。" +
        "list / search 打出的编号就是全局编号，可以直接拿来 read。" +
        "自动提取的画像会先进收件箱（status=pending），用户没审批前不会注入；" +
        "action=update 把 status 改成 active 就是\"接受\"，改成 rejected 就是\"丢弃\"。" +
        "【可直接写】你自己踩坑后总结的经验/教训不需要用户同意，直接 add（tags 带\"经验\"），写完告知用户一句即可；" +
        "写之前先 search 一下，避免重复记同一条经验。" +
        "写 category=persona（关于用户本人）的条目时，用\"日期 + 场景 + 他的原话/具体行为 + 至多一句判断\"，不要写成人格侧写；有疑虑就别写。",
      parameters: {
        action: {
          type: "string",
          required: true,
          enum: ["list", "read", "add", "update", "remove", "search"],
          description: "list / read / add / update / remove / search。",
        },
        id: { type: "string", description: "记忆 id（与 index 至少给一个）。" },
        index: { type: "integer", description: "记忆编号，1 起，与 list 输出一致。" },
        content: { type: "string", description: "记忆内容（add 必填；update 可选）。写一句可独立理解的话。" },
        keyword: { type: "string", description: "搜索关键词（search 必填）。" },
        tags: { type: "string", description: "逗号分隔的标签。" },
        category: { type: "string", description: "分类：global / persona / project / ephemeral / general。" },
        priority: { type: "string", description: "优先级：high / medium / low。" },
        project: { type: "string", description: "项目名（category=project 时用）。" },
        ttlDays: { type: "number", description: "有效期天数；0 或不给 = 永久。" },
        status: { type: "string", description: "状态：active / pending / rejected。" },
        confirm: { type: "boolean", description: "删除确认：action=remove 时必须第二次调用并传 true。" },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            action: { type: "string", required: true },
            detail: { type: "string", required: true },
          },
        },
        render: (args, value) => [{ type: "text", text: value.detail }],
      },
      isConcurrencySafe: () => false,
      async execute(args, exec) {
        const action = args.action
        // v0.4.3：宿主会告诉这次调用属于哪个 agent/会话。用它给 ephemeral 绑定会话，
        // 比用「最近一条用户消息的会话」更准（并行子代理不会把它带偏）。
        const execSessionId = String(exec?.agent?.session?.id ?? "")
        const store = read()

        // 编号 = 在库里的全局序号（1 起），与注入段、记忆页完全一致。
        // v0.4.1 修正：之前 search 传的是"命中数组的下标"，用户照着编号 read 会读错条目。
        const describe = (item, number) => {
          const tags = item.tags.length > 0 ? ` [${item.tags.join(",")}]` : ""
          const marks = []
          if (item.category !== "general") marks.push(item.category)
          if (item.priority !== "medium") marks.push(item.priority)
          if (item.status !== "active") marks.push(item.status)
          const extra = marks.length > 0 ? ` (${marks.join("/")})` : ""
          return `- ${number}. [${item.id}] ${item.content}${tags}${extra}`
        }

        if (action === "list") {
          if (store.entries.length === 0) return { action, detail: "长期记忆为空，现在还没有记住任何内容。" }
          const lines = store.entries.map((item, offset) => describe(item, offset + 1))
          const pending = store.entries.filter((entry) => entry.status === "pending").length
          const head = `共 ${store.entries.length} 条记忆${pending > 0 ? `（其中 ${pending} 条在收件箱待审批）` : ""}：`
          return { action, detail: `${head}\n${lines.join("\n")}` }
        }

        if (action === "read") {
          const target = resolveTarget(store, args)
          if (target === undefined) throw new Error("remember: action=read 需要 id 或 index")
          const number = store.entries.indexOf(target) + 1
          const facts = [
            `类别 ${target.category}`,
            `优先级 ${target.priority}`,
            `状态 ${target.status}`,
            `来源 ${target.source}`,
            target.project ? `项目 ${target.project}` : "",
            target.expiresAt ? `到期 ${target.expiresAt.slice(0, 10)}` : "",
            target.tags.length > 0 ? `标签 ${target.tags.join(" ")}` : "",
          ].filter(Boolean)
          return {
            action,
            detail: `第 ${number} 条 [${target.id}]\n${target.content}\n${facts.join(" · ")}\n创建于 ${target.createdAt.slice(0, 10)}`,
          }
        }

        if (action === "add") {
          const content = typeof args.content === "string" ? args.content.trim() : ""
          if (content.length === 0) throw new Error("remember: action=add 需要 content")
          if (byteLength(content) > MAX_CONTENT_BYTES) throw new Error(`remember: content 超过 ${MAX_CONTENT_BYTES} 字节，请拆成多条`)
          const category = CATEGORIES.includes(args.category) ? args.category : "general"
          const entry = normalizeEntry({
            id: newId(),
            content,
            category,
            priority: PRIORITIES.includes(args.priority) ? args.priority : "medium",
            project: typeof args.project === "string" ? args.project.trim() : "",
            tags: args.tags ?? [],
            source: "agent",
            status: "active",
            expiresAt: expiresFrom(args.ttlDays),
            // v0.4.3：ephemeral 必须绑定当前会话，否则 sessionId 为空 → 永远休眠，
            // 这个类别等于建了却用不了（实测：会话 A 里 add 的 ephemeral 一条都注入不进去）。
            sessionId: category === "ephemeral" ? execSessionId || currentSessionId : "",
            createdAt: nowIso(),
            updatedAt: nowIso(),
          })
          const outcome = mutate((store) => {
            if (!effectiveFlags(store).enabled) throw new Error("remember: 记忆已关闭，无法写入。")
            if (store.entries.some((item) => item.content === content)) return { duplicate: true, __skipWrite: true }
            store.entries.push(entry)
            return { added: true }
          })
          if (outcome?.duplicate) return { action, detail: `已存在相同内容，未重复添加：${content}` }
          return { action, detail: `已记住 [${entry.id}]（${entry.category}）：${content}` }
        }

        if (action === "update") {
          const nextContent = typeof args.content === "string" ? args.content.trim() : ""
          // v0.4.1：update 之前不校验长度，能把一条记忆改成超过注入预算的巨无霸。
          if (nextContent.length > 0 && byteLength(nextContent) > MAX_CONTENT_BYTES) {
            throw new Error(`remember: content 超过 ${MAX_CONTENT_BYTES} 字节，请拆成多条`)
          }
          const outcome = mutate((store) => {
            const target = resolveTarget(store, args)
            if (target === undefined) throw new Error("remember: action=update 需要 id 或 index")
            if (nextContent.length > 0) target.content = nextContent
            if (CATEGORIES.includes(args.category)) target.category = args.category
            // v0.4.3：改成 ephemeral 时补上会话绑定，否则它永远不会被注入。
            const bindSession = execSessionId || currentSessionId
            if (target.category === "ephemeral" && target.sessionId.length === 0 && bindSession.length > 0) {
              target.sessionId = bindSession
            }
            if (PRIORITIES.includes(args.priority)) target.priority = args.priority
            if (["active", "pending", "rejected"].includes(args.status)) target.status = args.status
            if (typeof args.project === "string") target.project = args.project.trim()
            if (typeof args.tags === "string") target.tags = args.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
            if (args.ttlDays !== undefined) target.expiresAt = expiresFrom(args.ttlDays)
            target.updatedAt = nowIso()
            return {
              id: target.id,
              category: target.category,
              priority: target.priority,
              status: target.status,
              content: target.content,
            }
          })
          return {
            action,
            detail: `已更新 [${outcome.id}]（${outcome.category}/${outcome.priority}/${outcome.status}）：${outcome.content}`,
          }
        }

        if (action === "remove") {
          // v0.4.1：删除必须二次确认。第一次调用只回显要删的内容，不落盘。
          if (args.confirm !== true) {
            const preview = resolveTarget(read(), args)
            if (preview === undefined) throw new Error("remember: action=remove 需要 id 或 index")
            const previewNumber = Number(args.index)
            if (Number.isSafeInteger(previewNumber) && previewNumber >= 1) {
              if (pendingRemovals.size > 200) pendingRemovals.clear()
              pendingRemovals.set(previewNumber, preview.id)
            }
            return {
              action,
              detail:
                `即将删除 [${preview.id}]：${preview.content}\n` +
                "删除不可撤销。确认要删，请再次调用 remember（action=remove）并带上 confirm=true。",
            }
          }
          const outcome = mutate((store) => {
            const target = resolveTarget(store, args)
            if (target === undefined) throw new Error("remember: action=remove 需要 id 或 index")
            // v0.4.3：两次调用之间如果别的写入让编号发生位移，按编号 confirm 会删到另一条
            // 记忆（实测：预览 #2 是「几何铁律」，删掉 #1 之后再 confirm #2 删的是「水印规律」）。
            const hasId = typeof args.id === "string" && args.id.trim().length > 0
            const confirmedNumber = Number(args.index)
            const previewed = Number.isSafeInteger(confirmedNumber) ? pendingRemovals.get(confirmedNumber) : undefined
            if (!hasId && previewed && previewed !== target.id) {
              const error = new Error(
                `remember: 编号 ${confirmedNumber} 现在指向 [${target.id}]，和上次预览的 [${previewed}] 不是同一条，已拒绝删除。` +
                  "请重新预览要删的那条，或直接用 id 删除。",
              )
              error.code = "MEMORY_CONFIRM_MISMATCH"
              throw error
            }
            if (Number.isSafeInteger(confirmedNumber)) pendingRemovals.delete(confirmedNumber)
            store.entries = store.entries.filter((entry) => entry.id !== target.id)
            return { id: target.id, content: target.content, left: store.entries.length }
          })
          return { action, detail: `已删除 [${outcome.id}]：${outcome.content}（剩余 ${outcome.left} 条）` }
        }

        if (action === "search") {
          const keyword = typeof args.keyword === "string" ? args.keyword.trim().toLowerCase() : ""
          if (keyword.length === 0) throw new Error("remember: action=search 需要 keyword")
          const hits = store.entries
            .map((item, offset) => ({ entry: item, number: offset + 1 }))
            .filter(({ entry }) =>
              `${entry.content} ${entry.tags.join(" ")} ${entry.project}`.toLowerCase().includes(keyword),
            )
          if (hits.length === 0) return { action, detail: `没有匹配 "${args.keyword}" 的记忆（共 ${store.entries.length} 条）` }
          return {
            action,
            detail: `匹配 ${hits.length} 条：\n${hits.map(({ entry, number }) => describe(entry, number)).join("\n")}`,
          }
        }

        throw new Error(`remember: 未知 action "${action}"`)
      },
    }),
  )

  // ── 会话事件：缓存最近一条提问 + 自动提取 ────────────────────────────────
  ctx.on("session/event", (session, event) => {
    if (!event || event.type !== "user/message") return
    const kind = event.data?.source?.kind
    if (kind !== undefined && kind !== "user") return
    const parts = Array.isArray(event.data?.content) ? event.data.content : []
    const text = parts.filter((block) => block?.type === "text").map((block) => block.text).join("\n")
    noteTurn(text, session?.id, isTopLevelSession(session))
    captureAuto(text)
  })

  for (const eventName of ["turn/end", "agent/turn-end", "conversation/user-message", "user/message"]) {
    try {
      ctx.on(eventName, (payload) => {
        if (!payload) return
        const flat = (value) => {
          if (typeof value === "string") return value
          if (!value || typeof value !== "object") return ""
          if (typeof value.content === "string") return value.content
          if (Array.isArray(value.content)) {
            return value.content.filter((b) => b?.type === "text").map((b) => b.text).join("\n")
          }
          return typeof value.text === "string" ? value.text : ""
        }
        const text = flat(payload.userMessage) || flat(payload.message) || flat(payload) || flat(payload.text)
        if (text) {
          noteTurn(text, payload.sessionId)
          captureAuto(text)
        }
      })
    } catch {
      /* 该版本没有这个事件名：忽略。 */
    }
  }
}
