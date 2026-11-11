# DSH 第三方长期记忆插件（非官方）

**DeepSeek Harness（DSH）的第三方长期记忆插件。** 内部标识：`dsh-thirdparty-memory`。

> **与本项目无关的声明**：本项目是独立第三方开源项目，与 DeepSeek、豆包及相关官方团队**没有关联**，也未获其授权或背书。文中出现的产品名仅用于说明兼容性，不构成任何官方关系。

一个总开关、自动提取、五类记忆、审阅收件箱、按关键词精准注入、本地记忆页，外加一个单文件 Windows 管理程序 —— 界面支持 English / 简体中文 / 繁體中文。

> **文档**：本文件的英文版是根文档 [README.md](README.md)，另见 [繁體中文](README.zh-TW.md)。
> 每份文档都同时提供纯文本版：`README.txt`、`README.zh-CN.txt`、`README.zh-TW.txt`。
> **深入阅读**：[docs/tutorial.zh-CN.md](docs/tutorial.zh-CN.md)（同时提供 `.txt`；英文与繁中版在 `docs/` 内）。

> **Steel**：首个面向 DSH 的零信任本地记忆插件。
>
> - 灵感来源于某个大厂的黑盒记忆：“你主动要求的记忆才会展示在这里。” 我受够了这种傲慢。
> - 作者：15 岁。曾就读于中华人民共和国辽宁省大连市轻工业学校食品加工工艺专业（9 天被劝退）。
> - 联系方式：受限于网络环境，不常看 GitHub，请通过中国大陆社交平台：抖音（非 TikTok）Steelgang、QQ 2278998874 联系。请使用 English 或者简体中文交流。 添加好友时请备注：GitHub 用户名 + 项目名 + 来意。 请遵循 UTC+8 中国北京时间沟通，否则可能无法接到消息。
> - 开发成本：50 元 API 费用，一台 Windows 笔记本。
> - 核心理念：**Never Trust the LLM.** 记忆是用户的数字资产，不是模型的免费养料。
> - 数据存储：单个 SQLite 文件，永不上云。卸载 / 更换模型？带走文件，你的记忆就永生。

```
版本     : 0.4.3（2026-11-10）· MIT · 非官方
支持平台 : DSH Desktop（MSIX）· DeepSeek Harness 便携版（Electron）· 命令行 `dsh web`
运行环境 : Node.js 18+（exe 自带 Node 24；SQLite 存储需要 `node:sqlite`，即 Node 22.5+）
存储方式 : 本地 SQLite（`node:sqlite` 内置，WAL 模式）—— 无服务端、无云端、无遥测
向量索引 : 本地哈希 n-gram 索引（256 维、余弦相似度）—— 零依赖、不联网
许可证   : MIT
```

---

## 为什么做这个

AI 的记忆有两种典型的翻车方式：**记太少**（每次新开对话都要重复你的偏好、项目路径和之前踩过的坑），和**记太多**（把所有东西一股脑塞进系统提示词，白烧 token，还用无关信息把模型带偏）。

dsh-thirdparty-memory 走中间那条路：记忆先**分类**，注入前先**按相关性过滤**，而 AI 自己推断出来的关于你的事，必须过一道**审阅收件箱**才可能进提示词。

---

## 功能一览

| | |
| --- | --- |
| **五类记忆** | `global` 全局（每轮注入）· `project` 项目（随项目激活）· `persona` 画像（每轮注入）· `ephemeral` 临时（仅本会话）· 以及 `general` 一般 |
| **关键词相关注入** | 只有和当前消息匹配的条目进提示词，其余压缩成编号索引。典型情况：无关提问时 6.5 KB → 1.2 KB。 |
| **多话题覆盖** | 一句话里提了好几件事时，每个话题各自分到代表条目，避免一个热门话题吃掉全部预算。 |
| **显式提取** | 说「把所有关于 X 的记忆都提取出来」即关闭相关性阈值、放宽预算，整批返回。 |
| **审阅收件箱** | 自动提取的画像类记忆先待在收件箱，你点通过之后才会被注入。 |
| **模型自主记录** | 由 agent 自己判断什么值得记（踩过的坑、结论、关于你的信息）并直接写入 —— `judgeMode: model`（默认）。 |
| **只更新，不堆叠** | agent 先搜索再改写已有条目：一个事实只有一条记忆，且永远是最新文本。 |
| **`[全局]` 前缀** | 记忆内容以 `[全局]` / `[global]` 开头即每轮注入。 |
| **Token 仪表盘** | 逐段显示字节/token 开销，常驻记忆挤占预算时会告警。 |
| **提示词预览** | 一键查看新会话真正会收到的注入文本。 |
| **单文件管理器** | `dsh-memory-manager.exe`（~34 MB）内嵌 Node 与全部资源；双击即用，托盘常驻，不用记网址。 |
| **SQLite 存储** | 用 Node 内置的 `node:sqlite`，WAL 模式，一个本地库文件 —— 照样不需要装任何东西。 |
| **本地向量索引** | 字符/词 n-gram 哈希到 256 维，余弦相似度与关键词得分混合 —— 只认字面相近，不认同义词；`vector: false` 可关。 |
| **零运行时依赖** | 服务端只用 `node:http`，不需要 `npm install`。 |

---

## 五种记忆分类

| 分类 | 含义 | 何时注入 |
| --- | --- | --- |
| 🌍 `global` | 语言偏好、硬性禁止、工作流规矩 | **每一轮** |
| 📁 `project` | 绑定某个项目的路径、坑、脚本、规格 | 该项目处于激活状态时（消息里点名，或设置了 `currentProject`） |
| 👤 `persona` | 你在意什么、烦什么、口味、习惯 | **每一轮** |
| ⏳ `ephemeral` | 本次对话的临时上下文 | 仅同一会话 |
| 📝 `general` | 其它一切 | 按关键词相关性 |

每条记忆还带 **优先级**（`high` 必须遵守 / `medium` 建议 / `low` 参考）和可选的 **有效期**（永久 / N 天）。

> **项目记忆既是闸门也是筛子**：项目激活后，该项目的条目只是获得**入选资格**，仍然要过关键词过滤才会被注入。切到某个项目，绝不等于把它的全部记忆倒进提示词。

### `persona` 条目必须长什么样

用第三人称给用户做侧写的记忆系统，很快就会变得毛骨悚然。区分"能用"和"悚"的不是语气，而是**证据** —— 一条合格的画像条目同时具备四个特征：

| 特征 | 含义 | 为什么重要 |
| --- | --- | --- |
| **带日期** | 写明这条观察是哪天得到的 | 没有日期的观察永远不会过期，而画像会过期 |
| **有场景** | 指认到底发生了什么 | 场景可以被核对，性格标签不能 |
| **有锚点** | 保留用户的原话或一个明确动作 | 转述正是臆造混进来的地方 |
| **一句解读** | 判断放在最后，且只有一句 | 证据保持完整，解读和证据分得开 |

不合格的条目是反过来的样子：形容词开头、没有日期、没有场景、读者无法证实也无法否认。一整个文件都是这种条目，就是"你凭什么给我建档"的来源。

结构模板（只给结构，不给内容）：`YYYY-MM-DD  <发生了什么>  —— "<用户原话>"  —— <一句解读>`。

想不起场景和原话，就不要写 —— 画像栏留空，比编一条填满更好。

---

## 安装

### 方式一：管理程序 exe（最省事）

运行 `dsh-memory-manager.exe`。首次启动会问界面语言（English / 简体中文 / 繁體中文），把自带运行时解压到 `%LOCALAPPDATA%\dsh-thirdparty-memory\`，启动记忆页并在浏览器打开。之后托盘常驻：

`打开记忆页` · `复制网址` · `存储位置…` · `打开存储目录` · `更改端口…` · `重启/停止服务` · `挂载到 DSH…` · `语言` · `退出`

```
dsh-memory-manager.exe                     打开记忆页并常驻托盘
dsh-memory-manager.exe --install           把插件挂载到所有检测到的 DSH profile
dsh-memory-manager.exe --start / --stop / --restart / --status
dsh-memory-manager.exe --port 7900         自定义端口（端口被占用则拒绝启动）
dsh-memory-manager.exe --store D:\dsh-mem  自定义存储目录（规则见下）
dsh-memory-manager.exe --lang zh-CN        切换界面语言
```

### 方式二：脚本

```powershell
powershell -ExecutionPolicy Bypass -File .\attach.ps1                 # 自动挂载所有检测到的 profile
powershell -ExecutionPolicy Bypass -File .\attach.ps1 -CreateWeb      # 顺带创建缺失的 web profile
powershell -ExecutionPolicy Bypass -File .\attach.ps1 -Repair         # 去掉各 profile 清单里的 UTF-8 BOM
powershell -ExecutionPolicy Bypass -File .\attach.ps1 -ProfileDir "C:\Users\you\.dsh\profiles\web"
powershell -ExecutionPolicy Bypass -File .\attach.ps1 -DataFile "D:/dsh-mem/memory.json"
```

不传 `-DataFile` 时，脚本会保留 patch 里已有的 `dataFile` —— 它不再删掉那一行（以前删掉等于偷偷换了记忆位置）。`-Repair` 只修清单：打印 `fixed=… clean=… invalid=…` 后直接退出。

### 方式三：手工四步

以 `%APPDATA%\com.yeagoo.dsh-desktop\harness\profiles\web` 这类 profile 目录为例：

1. `mklink /J "<profile>\node_modules\dsh-thirdparty-memory" "<插件目录>"`（也可以直接复制文件夹）
2. 在 profile 的 `package.json` 里把 `"dsh-thirdparty-memory"` 加进 `dsh.profile.bundles`
3. 往 `cordis.patch.yml` 追加：
   ```yaml
   - id: thirdparty-memory
     name: dsh-thirdparty-memory
     config:
       enabled: true
       judgeMode: model
       inbox: true
   ```
4. 给插件配好对等依赖：把 `<插件>\node_modules\@deepseek-ai\dsh-tools` 链接到宿主里的同名包

**重启 DSH。** bundle 只在启动时读取。之后 *设置 → 插件* 里会出现 `dsh-thirdparty-memory`，记忆页在 <http://127.0.0.1:7891/>。

---

## 日常怎么用

```
你：记住：<一条事实，必要时带上原因>
    → 明确要求，立即入库，无需审阅

你：[全局] <必须每一轮都成立的规矩>
    → 这条从今往后每一轮都注入；全局条目是最贵的字节

你：<关于话题 A 的任务>，然后 <关于话题 B 的任务>
    → 只注入 A 和 B 相关的记忆，其余折叠成索引

你：把所有关于 <某话题> 的记忆都提取出来
    → 显式提取：关掉相关性阈值、放宽预算，整批给你

你：删掉第 3 条 / 把第 9 条改成：<新内容>
    → remember remove / remember update；编号与记忆页一致
```

画像类记忆不用你开口：agent 会按上面那四个特征自己判断（`judgeMode: model`），只有拿到日期、场景和你的原话时才写一条。记错了就在记忆页删掉 —— 所有删除都要二次确认。

---

## 记忆页

<http://127.0.0.1:7891/>（同时监听 `127.0.0.1`）

| 栏目 | 作用 |
| --- | --- |
| 🧠 **核心记忆库** | 全部条目，可筛分类、置顶/取消置顶、删除（二次确认）；点条目进入工作台抽屉 |
| 📥 **记忆收件箱** | 自动提取的画像条目，逐条或批量 通过 / 编辑 / 拒绝 |
| 📊 **Token 仪表盘** | 各段字节与 token 占比、预算告警、记忆库整体指标 |
| 🔍 **搜索** | 按内容、标签、项目关键词搜索 |
| ⚙️ **设置** | 总开关、自动提取、**由谁判断该记什么**、索引开关、注入参数、语言、导出 JSON |
| 👁 **提示词预览** | 新会话真正会收到的注入文本 |

---

## 配置

两层配置，后者覆盖前者：`cordis.patch.yml`（部署层）→ 存在记忆库（`memory.sqlite`）里的记忆页设置（用户层）。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 硬开关。关闭 = 不注入、不提取、`add` 也失败。 |
| `judgeMode` | `model` | `model` 由模型判断该记什么 · `rules` 内置正则兜底 · `off` 从不自动记录 |
| `autoExtract` | `true` | 仅当 `judgeMode: rules` 时生效 |
| `inbox` | `true` | 正则提取出的画像条目需要审阅 |
| `injectMode` | `relevant` | `relevant` 按关键词选 · `all` 全量注入 |
| `maxBytes` | `8192` | 注入字节预算 |
| `maxRelevant` | `6` | 每轮最多匹配条目数 |
| `perCluster` | `2` | 多话题时每个话题的条目数 |
| `minScore` | `6` | 相关性阈值（越大越严） |
| `recallMaxBytes` | `16384` | 显式提取时放宽的预算 |
| `maxRecall` | `40` | 显式提取最多返回条数 |
| `showIndex` | `true` | 是否附带未选中条目的编号索引 |
| `indexChars` | `18` | 索引里的标题长度 |
| `currentProject` | `""` | 当前项目名（项目条目因此获得资格） |
| `dataFile` | `""` | 记忆文件路径。留空 = `%APPDATA%\dsh-thirdparty-memory\memory.sqlite`。写 `.json` 路径也认，会映射到同目录同名的 `.sqlite`。 |
| `vector` | `true` | 本地向量索引开关。`false` = 纯关键词检索。 |
| `vectorWeight` | `1` | 余弦加成的权重。`0` 等于完全关掉加成。 |
| `vectorMinCos` | `0.3` | 余弦下限，低于它不加分（越大越严）。 |
| `pageServer` / `pageHost` / `pagePort` | `true` / `127.5.0.1` / `7891` | 记忆页进程 |

### 存储规则

每次更改目录（`存储位置…` 或 `--store`）时管理器都会强制校验：

1. **盘符必须存在**；
2. 每一级文件夹名必须是 **ASCII**（`A-Z a-z 0-9 空格 _ - .`）；
3. 目标文件夹必须**为空**（或本来就是当前存储目录）；
4. 不允许直接选盘符根目录。

如果旧目录里还有记忆，管理器会问 **是否迁移？** —— *是* 复制过去，*否* 只切换、旧数据留在原处，*取消* 放弃。切换成功后会把 `dataFile` 写进每个已挂载 profile 的 `cordis.patch.yml`，保证插件和记忆页读的是同一个库。

---

## 存储、向量与更新

### 数据到底在哪（0.4.0）

记忆库是一个**本地 SQLite 数据库**，通过 Node 内置的 `node:sqlite` 打开 —— 没有原生模块、不需要 `npm install`、没有服务端。开了 WAL 模式，记忆页和插件读写互不阻塞。

| | |
| --- | --- |
| `dataFile` 可写 | `.json` 路径（兼容老配置）或 `.sqlite` 路径 |
| 实际的库 | 同目录、同主名：`memory.json` → `memory.sqlite` |
| 默认位置（Windows） | `%APPDATA%\dsh-thirdparty-memory\memory.sqlite` |
| 改目录 | 设置环境变量 `DSH_THIRDPARTY_MEMORY_HOME` |
| 运行时没有 `node:sqlite`（Node < 22.5） | 自动**回退**成同一路径下的 JSON 存储，功能不缩水（向量检索除外） |

默认目录**故意放在插件目录之外**：更新插件换的是代码，而换代码不该碰记忆。老版本把文件放在 `<插件>\data\memory.json` —— 正是更新时会覆盖的位置 —— 所以现在只把它当**只读迁移来源**。

老用户不受影响：配置里已经写了 `dataFile` 的，0.4.0 沿用它，路径一点不变；只有从没配置过 `dataFile` 的新装用户才会落到新的默认目录。

### 一次性 JSON → SQLite 迁移：只复制，不改原件

第一次读取时，如果 `.sqlite` 库还不存在、但找到了 JSON 记忆库：

1. 先把 JSON 复制成同目录下的 `memory.json.bak_pre_sqlite_<ISO时间戳>`；
2. 把这份副本导入新库；
3. **原 JSON 不修改、不删除、不改名。**

只做一次，之后以数据库为准。那份备份就是退路：万一运行环境变了，JSON 还在原处。

### 本地向量索引

0.4.0 加了一层本地向量，**离线、零依赖**：

* 输入：字符 1/2/3-gram，加上拉丁词；
* 每个 token 用 FNV-1a 哈希到 256 维，TF 加权，再做 L2 归一；
* 向量以 Float32 BLOB 存进同一个库；
* 检索得分 = 关键词得分 + 余弦加成 `round(cos × 12 × vectorWeight)`；余弦低于 `vectorMinCos` 的配对不加分。

这个能力的边界要写清楚：它抓的是**字面相近** —— 同字、同词、语序变化、问题里重复了条目中的一部分。它**不是**同义词级别的语义：只认共同的字和词，不认相同的意思。

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `vector` | `true` | `false` = 纯关键词检索 |
| `vectorWeight` | `1` | 余弦加成的权重；`0` 等于关掉 |
| `vectorMinCos` | `0.3` | 余弦下限；调低 = 匹配更多（也更松） |

没有 `node:sqlite` 就没有向量表，检索退化成纯关键词 —— 这是回退时唯一不保留的功能。

### 更新安全

* **更新/替换插件目录只换代码。** 不覆盖、不迁移、不改名、不删除任何记忆文件。
* **`attach.ps1` 会保留已有的 `dataFile`。** 不传 `-DataFile` 时它不动配置里的路径；以前它会删掉那一行，等于把记忆库偷偷挪了位置。
* **`attach.ps1 -Repair`** 会扫描每个 DSH profile 的 `package.json`，带 UTF-8 BOM 的先备份、再去掉 BOM 重写。

### BOM 崩溃（0.4.0 已修）

Store/MSIX 版 DSH Desktop 装完一重启就崩，每次必崩。根因是 profile 的 `package.json` 被写成了 **UTF-8 with BOM**；宿主的 `readProfileManifest` 直接 `JSON.parse`、不剥 BOM，于是抛 `SyntaxError: Unexpected token '\uFEFF'`，退出码 `1` —— 连崩 3 次后宿主就不再自动重启了。

修复：两个安装器（`attach.ps1` 与管理器 exe）全部改成无 BOM 写入；读取容错 BOM；`-Repair` 可以修既有的坏清单。

---

## 0.4.3 修复

0.4.3 是 0.4.2 之上的正确性版本。不改存储格式、不改配置、不需要迁移：替换插件文件即可，SQLite 库和 JSON 库都按原来的方式读。

### 并发缺陷：一次读只取一个快照

`readStore` 把条目行和 `revision` 计数分两条语句读。DSH 宿主和记忆页天然是两个写入方，只要其中一个在两条语句之间提交，另一个就会读到「**旧条目 + 新 revision**」；乐观锁看到 revision 相同便放行，把刚写进去的那条整条删掉——全程不报错。用 4 个进程各写 25 条复现：`revision` 到 101，表里只有 100 条。现在 `readStore` 把条目行、设置和 revision 包在同一个读事务里（`BEGIN` … `COMMIT`）。

### `storageInfo()` 不再创建空数据库

记忆页的状态查询会打开 SQLite 文件读计数。打开一个不存在的路径会创建空数据库，于是「库丢失 + 迁移哨兵」的降级状态在页面刷新一次之后就被悄悄解除：下一次读看到的是一个正常的空库，写入照常放行。现在文件不存在时 `storageInfo()` 什么都不创建，只报 0。

### 注入跟着正确的会话走

「最近一条用户消息」原来存在一个全进程共享的变量里。任何会话——第二个窗口或子代理——都会把它覆盖掉，结果一个会话的注入段是按另一个会话的文字挑的（实测：主会话问插件 bug，子代理提到另一个项目，主会话的注入立刻改选那个项目的记忆）。现在按会话各存一份；每次组装提示词都通过 assembly 上下文（`scope.session.id`）查自己的会话，全进程兜底只接受顶层会话。

### 按编号删除会先复核目标

`remember remove` 先回显条目，第二次带 `confirm=true` 才真删。如果两次调用之间有写入让编号发生位移，确认的编号就指向了另一条，删错记忆（实测：预览 #2，先删 #1，再 confirm #2 —— 删掉的是原来的 #3）。现在预览时按编号记下条目 id；确认时对不上就以 `MEMORY_CONFIRM_MISMATCH` 拒绝，并要求重新预览。按 `id` 删除不受影响。

### 其他小修

* `ephemeral` 条目原来没有 `sessionId`，这个类别永远匹配不上当前会话、从来不会被注入。现在会话直接取自工具调用本身（`exec.agent.session.id`）。
* 超过 128 KB 的请求体原来会以连接重置收场，而不是预期的 `413`：处理器在应答前就把 socket 销毁了。现在返回 `413` 并排空请求体。
* `server.js` 注释里一个坏字符已替换。

验证：核心层与 HTTP 回归各 39 / 30 项全过（隔离数据目录与端口）；4 进程并发跑 3 轮，每轮 101 条、revision 101；库丢失、库损坏、JSON 迁移、备份、编号一致性均检查；记忆页用无头 Edge 实渲染，无未翻译键、条目内容无 XSS。真实库未受影响（前后都是 59 条，WAL 0 字节）。

## 0.4.2 维护修复

* `POST /api/entry/delete` 要求 `confirm: true`，与命令行从 0.4.1 起就执行的规则一致。不带时返回 `409`；重复删除已不存在的条目返回 `404`。
* `storageInfo` 报告真实的 revision、上次备份时间和向量条数。它原来从一个尚未打开的数据库句柄读这些值，所以新进程总是报 0，记忆页永远显示「没有备份」。
* 批量清空依旧故意不做。0.4.2 的一个未发布草稿曾有 `WIPE` 门控接口和设置页按钮，发布前已撤回。要清就一条一条删——页面每次都会问两遍。
* 全接口回归 + 5000 条性能检查。

## 0.4.1 数据安全修复

0.4.1 修复了 0.4.0 的 SQLite 存储里的一组数据安全缺陷。下面每一条都会改变你能观察到的行为。

### 每次写入后做 checkpoint

每次写入结束都会执行 `PRAGMA wal_checkpoint(TRUNCATE)`，把 WAL 合并回 `memory.sqlite`。主库从此自带全部数据，不再是只有 4 KB 的空壳、真正的内容压在 `-wal` 文件里。只复制/备份 `memory.sqlite` 一个文件就能读出全部记忆；0.4.0 时同样只拷主库，会得到 0 条，而且不报错。

`-wal` / `-shm` 在进程打开库时依然会出现，但它们是运行期的临时文件，不属于备份的一部分。

### 读库失败改为降级，不再静默回退

SQLite 读不出来时，插件不再回退到旧的 `memory.json` 快照，而是进入 **degraded 降级状态**：系统提示词注入段会以一条醒目的警告开头，写明原因和库文件路径；记忆页显示同样的警告；并且**禁止写入**（`MEMORY_DEGRADED`），避免那份过时的快照把真正的库覆盖掉。

### 迁移哨兵：`memory.sqlite.migrated`

迁移完成后会在数据库旁边写一个哨兵文件。之后这个库一旦丢失，插件不会拿旧 JSON 再拼出一个库 —— 哨兵记录着「这个库已经迁移过，JSON 只是历史」。确实想重新迁移时，删掉这个哨兵文件即可。

### 自动备份

每天第一次写入时，插件用 `VACUUM INTO` 在 `<存储目录>\backups\memory-<时间戳>.sqlite` 生成一份快照。它是自包含的单文件（不依赖 `-wal`），保留最近 30 份。

### 写入加乐观锁

写入是整表替换，所以 DSH 宿主和记忆页同时写时，以前会有一方的条目整条丢失。现在每次写入都会核对 SQLite `meta` 表里的 `revision` 计数；版本对不上就重新读取再重放，而不是直接覆盖。

### `remember` 工具的修正

* `remove` 需要二次确认：第一次调用只回显要删的条目，第二次带 `confirm=true` 才真正删除。
* `search` 输出的编号改回全局编号。0.4.1 之前它打印的是命中结果里的序号，照着那个编号 `read` 会读到另一条。
* `update` 补上了 2048 字节的内容长度校验（`add` 之前就有）。

### 行为修正

* `status=archived` 不会再被静默改成 `active`。
* `global` 条目可以取消置顶；`global` 不再强制 `pinned`。
* 标签里的「画像」不再被静默删除。

---

## 数据格式

存储用的是 SQLite —— 路径、迁移与更新规则见 [存储、向量与更新](#存储向量与更新)。下面这个 JSON 结构是**回退**格式（运行时没有 `node:sqlite` 时读写它），也是 `GET /api/export` 导出的形状：

```json
{
  "version": 2,
  "entries": [
    {
      "id": "mem-xxxx", "content": "<一条事实，写成能独立理解的句子>",
      "category": "global", "project": "", "priority": "high",
      "tags": ["<标签>"], "source": "user", "status": "active",
      "pinned": true, "expiresAt": null, "sessionId": "",
      "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "settings": { "enabled": true, "lang": "zh-CN" }
}
```

`status`：`active` 生效 · `pending` 待审（收件箱）· `rejected` 已拒绝。版本 1 的文件会自动迁移（`[全局]` 前缀会转成 `category: "global"`）。SQLite 的表结构属于实现细节 —— 请通过记忆页或接口读数据，不要直接写 SQL。

---

## HTTP 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/` | 记忆页 |
| GET | `/api/state?q=` | 状态 + 条目 + 仪表盘 |
| GET | `/api/export` | 导出 JSON |
| POST | `/api/entry/add` · `/update` · `/delete` | 条目增删改（删除按设计只能一条一条来） |
| POST | `/api/inbox` · `/api/inbox/bulk` | 通过 / 拒绝 |
| POST | `/api/settings` | 写用户层设置（`{reset:true}` 恢复默认） |
| POST | `/api/preview` | 渲染指定 `q` 的注入结果 |

只监听回环地址；POST 要求 `application/json`，可以挡掉跨站表单提交。

---

## 疑难速查（完整表格见教程）

| 现象 | 原因 / 处理 |
| --- | --- |
| 装完没反应 | DSH 没重启；bundle 只在启动时加载 |
| DSH Desktop 装完一重启就退出码 1，连崩三次后不再自动重启 | profile 的 `package.json` 带了 UTF-8 BOM；跑 `attach.ps1 -Repair`，再重启 DSH |
| 更新插件后记忆「不见了」 | 先对照 patch 里的 `dataFile` 与 `dsh-memory-manager.exe --data` 的输出：老用户沿用原路径，新装用户默认 `%APPDATA%\dsh-thirdparty-memory\memory.sqlite` |
| 向量匹配感觉乱 / 老匹配到不想要的 | 调高 `vectorMinCos`（更严）、调低 `vectorWeight`，或直接 `vector: false` 走纯关键词 |
| *设置 → 插件* 里找不到插件 | 重跑 `attach.ps1` 并读它的输出 |
| 记忆页空白 | 页面进程挂了，跑 `dsh-memory-manager.exe --start` |
| 提示 `端口 7891 已被其它程序占用` | 端口被别的程序占了：`--port 7900`，或 *更改端口…* |
| agent 去翻插件目录，而不是直接回答 | 插件没被加载，于是没有记忆工具；重启 DSH |
| Defender 报毒（计划任务） | 不要用计划任务自启动（启发式误报）；用 exe 托盘或启动文件夹 |
| 记忆读起来像规章 | 切到 `judgeMode: model`，让模型写画像类记忆；收件箱里能看到它推断了什么 |

---

## 隐私

一切都只存在本地一个 SQLite 数据库里（外加它的 WAL 附带文件）：不发网络请求、不上传、不埋点 —— 向量索引也是在本地算、本地存。但记忆会进入模型上下文，**不要存密码和密钥**。破坏性操作一律二次确认，且刻意不提供「清空全部记忆」—— 只能一条一条删。

---

## 兼容性

| 宿主 | 状态 |
| --- | --- |
| DSH Desktop（MSIX，desktop 0.2.x） | 已实测 |
| DeepSeek Harness 便携版（Electron） | 已实测（`remember list` / `search` 验证通过） |
| 命令行 `dsh web` | 通过 `--dump-config` 验证组装正确 |

存储需要 `node:sqlite`（Node 22.5+）。宿主运行时更老时插件会自动回退到 JSON 存储、照常工作，只是没有向量检索。

插件刻意**不依赖 `schemastery`**（`Config` 直接实现 Standard Schema 的 `~standard` 契约），因此能跨 DSH 版本存活；它唯一需要的对等依赖是 `@deepseek-ai/dsh-tools`。

---

## 从源码构建

```bat
:: 重建单文件管理器（需要 .NET Framework 4.x 的 csc.exe 与一个 node.exe）
powershell -ExecutionPolicy Bypass -File build-single-exe.ps1

:: 打包 release\dsh-thirdparty-memory-<版本>.zip（内含敏感路径检查）
powershell -ExecutionPolicy Bypass -File build-release.ps1

:: 改完 Markdown 后重新生成纯文本文档
node tools/md2txt.mjs README.md README.zh-CN.md README.zh-TW.md docs/tutorial.md docs/tutorial.zh-CN.md docs/tutorial.zh-TW.md
```

---

## 许可证

MIT —— 见 [LICENSE](LICENSE)。内嵌的 Node.js 运行时按其自身 MIT 许可再分发（见 `docs/NODE-LICENSE.txt`）。
