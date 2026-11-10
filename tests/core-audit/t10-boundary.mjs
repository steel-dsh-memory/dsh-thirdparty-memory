/**
 * 用例 10：边界。
 * 10a：content 2048 字节（准确 2048 通过、2049 由谁拒绝？core 是否有约束）；
 * 10b：clipText 对中文/emoji 不切坏字符（含 ZWJ 组合 emoji 的已知局限）；
 * 10c：空 tags / 重复 tags / 极端 category 值的 normalizeEntry 回退。
 */
import { join } from "node:path"
import {
  MAX_CONTENT_BYTES,
  byteLength,
  clipText,
  loadStore,
  mutateStore,
  normalizeEntry,
  parseTags,
} from "../../core.js"
import { Audit, workDir } from "./helpers.mjs"

const audit = new Audit("t10", "2048 字节 / 截断 / tags / 回退")

const dir = workDir("t10-boundary")
const file = join(dir, "memory.sqlite")

audit.eq("MAX_CONTENT_BYTES 导出", MAX_CONTENT_BYTES, 2048)

// ── 10a：2048 / 2049 字节 ────────────────────────────────────────────────────
const exact = "a".repeat(2048)
const over = "a".repeat(2049)
audit.eq("ascii 2048 字节的 byteLength", byteLength(exact), 2048)
const entry2048 = normalizeEntry({ id: "b2048", content: exact })
audit.eq("normalizeEntry 对 2048 字节原样保留", byteLength(entry2048.content), 2048)
const entry2049 = normalizeEntry({ id: "b2049", content: over })
audit.eq("normalizeEntry 对 2049 字节是否截断/拒绝", byteLength(entry2049.content), 2049)

// 中文精确 2048 字节：682 个汉字 = 2046 字节 + 2 个 ascii
const cjkExact = "中".repeat(682) + "ab"
audit.eq("中文精确 2048 字节", byteLength(cjkExact), 2048)
audit.eq("中文 2048 字节原样保留", byteLength(normalizeEntry({ id: "c2048", content: cjkExact }).content), 2048)

mutateStore(file, (store) => {
  store.entries.push(normalizeEntry({ id: "b2048", content: exact }))
  store.entries.push(normalizeEntry({ id: "b2049", content: over }))
})
const store = loadStore(file)
audit.check("core 写入层是否接受 2049 字节（无调用方校验）", store.entries.some((entry) => entry.id === "b2049" && byteLength(entry.content) === 2049), "index.js:368 / server.js:348 才做 2048 校验，core 本身不设限")

// ── 10b：clipText ───────────────────────────────────────────────────────────
audit.eq("clipText 中文 5 字", clipText("中".repeat(10), 5), "中中中中中…")
audit.eq("clipText 不超长时原样返回", clipText("中文", 5), "中文")
audit.eq("clipText emoji 3 个", clipText("🎉🎊🥳😀🚀", 3), "🎉🎊🥳…")
const clippedEmoji = clipText("🎉🎊🥳😀🚀", 2)
audit.check(
  "clipText 不产生孤立代理项",
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(clippedEmoji),
  JSON.stringify(clippedEmoji),
)
audit.eq("clipText 结果长度 = chars + 1（含省略号）", [...clippedEmoji].length, 3)

const family = "👨‍👩‍👧‍👦"
const familyClipped = clipText(family, 3)
audit.check(
  "ZWJ 家庭 emoji 被按码点切开（视觉可能断裂，不产生无效 UTF-16）",
  [...family].length === 7 && [...familyClipped].length === 4,
  `points=${[...family].length} clipped=${JSON.stringify(familyClipped)} codePoints=${[...familyClipped].map((ch) => ch.codePointAt(0).toString(16)).join(" ")}`,
)
audit.check(
  "ZWJ 切开后仍是合法 UTF-16（无孤立代理项）",
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(familyClipped),
  JSON.stringify(familyClipped),
)
audit.eq("国歌旗/组合 emoji 的码点数", [..."🇨🇳"].length, 2)

// ── 10c：tags 与回退 ───────────────────────────────────────────────────────
audit.eq("空 tags 数组", normalizeEntry({ content: "x", tags: [] }).tags, [])
audit.eq("重复 tags 是否去重", parseTags("a,a,a"), ["a"])
audit.eq("中英文逗号都切", parseTags("甲，乙, 丙"), ["甲", "乙", "丙"])
audit.eq("tags 非字符串非数组", parseTags(42), [])
audit.eq("数组 tags 去空白", parseTags([" a ", "", " b "]), ["a", "b"])
audit.eq("tags 是对象", parseTags({ a: 1 }), [])
audit.eq("normalizeEntry 也去重 tags", normalizeEntry({ content: "x", tags: ["重复", "重复"] }).tags, ["重复"])

audit.eq("category 大写 GLOBAL 回退", normalizeEntry({ content: "x", category: "GLOBAL" }).category, "general")
audit.eq("category 数字回退", normalizeEntry({ content: "x", category: 7 }).category, "general")
audit.eq("category 未知值回退", normalizeEntry({ content: "x", category: "bogus" }).category, "general")
audit.eq("category 空 + pinned → global", normalizeEntry({ content: "x", category: "", pinned: true }).category, "global")
audit.eq("category 空 + 画像 tag → persona", normalizeEntry({ content: "x", category: "", tags: "画像" }).category, "persona")
audit.eq("legacy [全局] 前缀剥离", normalizeEntry({ content: "[全局] 内容" }).content, "内容")
audit.eq("legacy [global] 前缀剥离", normalizeEntry({ content: "[global] content" }).content, "content")
audit.eq("normalizeEntry(null) 不崩", normalizeEntry(null).category, "general")
audit.eq("status 非法回退 active", normalizeEntry({ content: "x", status: "bogus" }).status, "active")
audit.eq("archived 保持 archived（v0.4.1 修正）", normalizeEntry({ content: "x", status: "archived" }).status, "archived")
audit.eq("priority 非法回退 medium", normalizeEntry({ content: "x", priority: "urgent" }).priority, "medium")
audit.eq("source 非法回退 agent", normalizeEntry({ content: "x", source: "human" }).source, "agent")
audit.eq("byteLength emoji", byteLength("🎉"), 4)
audit.eq("byteLength 中文", byteLength("中"), 3)

audit.finish()
