DSH Third-Party Long-Term Memory Plugin (Unofficial)
====================================================

An unofficial, third-party long-term memory plugin for DeepSeek Harness (DSH). Package id: dsh-thirdparty-memory. 中文名：DSH 第三方长期记忆插件（非官方）。

  > Not affiliated. This is an independent open-source project. It is not associated with DeepSeek, Doubao, or their official teams, and carries no authorisation or endorsement from them. Product and company names are used only to describe compatibility.

One master switch, automatic extraction, five kinds of memory, a review inbox, keyword-relevant injection, a local memory page, and a single-file Windows manager — with English / 简体中文 / 繁體中文 UI.

  > Docs: this file is the English root. Translations: 简体中文 (README.zh-CN.md) · 繁體中文 (README.zh-TW.md).
  > Every document also ships as plain text: README.txt, README.zh-CN.txt, README.zh-TW.txt.
  > Deep dive: docs/tutorial.md (also as .txt, with zh-CN / zh-TW versions in docs/).

  > Steel — the first zero-trust local memory plugin for DSH.
  > 
  > - Inspired by a big-tech black-box memory: "Only the memories you actively request are shown here." I got tired of that arrogance.
  > - Author: 15 years old. Previously a food-processing major at an unnamed light-industrial vocational secondary school in Dalian, Liaoning, the People's Republic of China (asked to leave after 9 days).
  > - Contact: Due to network conditions, I do not check GitHub often. Please reach me via mainland China social platforms: Douyin (not TikTok) Steelgang, or QQ 2278998874. Please communicate in English or Simplified Chinese. When adding me, please follow the format: GitHub username + project name + purpose. Please communicate on UTC+8 (China Standard Time), otherwise I may not receive your messages.
  > - Build cost: ¥50 in API fees, one Windows laptop.
  > - Core belief: Never Trust the LLM. Memory is the user's digital asset, not free fodder for the model.
  > - Storage: a single SQLite file that never leaves your machine. Uninstall it, or switch models? Take the file with you — your memory lives on.

    Version   : 0.4.5 (2026-11-12) · MIT · unofficial
    Platforms : DSH Desktop (MSIX) · DeepSeek Harness portable (Electron) · CLI `dsh web`
    Runtime   : Node.js 18+ (the exe ships Node 24; SQLite storage needs `node:sqlite`, Node 22.5+)
    Storage   : local SQLite through the built-in `node:sqlite` (WAL) — no server, no cloud, no telemetry
    Vectors   : local hashed n-gram index (256 dims, cosine similarity) — no dependency, no network
    License   : MIT

------------------------------------------------------------------------

Why
---

AI conversations fail at memory in two opposite ways: it remembers too little (you repeat your preferences, project paths and past mistakes in every new chat) and too much (everything gets stuffed into the system prompt, burning tokens and confusing the model with irrelevant facts).

dsh-thirdparty-memory splits the difference: memories are classified, injection is relevance-filtered, and anything the AI infers about you has to pass a review inbox before it can ever reach the prompt.

------------------------------------------------------------------------

Features
--------

* Five categories
    global (always injected) · project (activates with its project) · persona (always injected) · ephemeral (this session only) · plus general

* Keyword-relevant injection
    Only entries matching the current message enter the prompt; the rest collapse into a numbered index. Typically 6.5 KB → 1.2 KB on unrelated questions.

* Multi-topic coverage
    Mention several things in one sentence and each topic gets its own representative entries, so one hot topic cannot eat the whole budget.

* Explicit recall
    Say "extract all memories about X" to drop the relevance threshold and get the whole batch (the budget widens too).

* Review inbox
    Every automatic write waits in the inbox; nothing the plugin infers reaches the prompt until you accept it. Only an explicit remember call from the agent writes directly.

* Self-directed writing
    The agent judges what is worth keeping (pitfalls, conclusions, personal facts) and writes it without asking — judgeMode: model (default). Explicit remember writes go in directly; everything the plugin infers on its own goes through the inbox first.

* Update, don't duplicate
    The agent searches first and updates the existing entry: one fact, one entry, always the latest text.

* [全局] prefix
    Any memory whose text starts with [全局] / [global] is injected every turn.

* Token dashboard
    See exactly how many bytes/tokens each section costs, with warnings when always-on memories crowd the budget.

* Prompt preview
    One click shows the exact text that would be injected into a new chat.

* Single-file manager
    dsh-memory-manager.exe (~34 MB, unsigned, distributed through GitHub Releases) embeds Node + everything; double-click, tray icon, no URL to remember.

* SQLite store
    node:sqlite (built into Node), WAL mode, one local database file — still nothing to install.

* Local vector index
    Character/word n-grams hashed into 256 dimensions, cosine similarity blended with keyword scoring — literal closeness, not synonyms; vector: false turns it off.

* Zero runtime deps
    The server is node:http; there is nothing to npm install.

------------------------------------------------------------------------

The five kinds of memory
------------------------

* 🌍 global
    Meaning: Language preference, hard prohibitions, workflow rules
    When injected: every turn

* 📁 project
    Meaning: Project-bound paths, pitfalls, scripts, specs
    When injected: only while that project is active (named in the message, or currentProject)

* 👤 persona
    Meaning: What you care about, what annoys you, taste, habits
    When injected: every turn

* ⏳ ephemeral
    Meaning: Scratch context for this conversation
    When injected: same session only

* 📝 general
    Meaning: Everything else
    When injected: keyword relevance

Each entry also carries priority (high must follow / medium recommended / low reference) and an optional TTL (never / N days).

  > **Project memories are a gate and a filter**: a project entry becomes eligible when its project is active, and is still keyword-filtered before injection. Activating a project never dumps all of its entries into the prompt.

What a persona entry has to look like

A memory system that profiles its user in the third person turns creepy fast. What separates a usable persona entry from a creepy one is not tone, it is evidence — a well-formed entry has four properties:

* dated
    What it means: it carries the date of the observation
    Why it matters: an undated observation cannot expire, and persona notes age

* scene-bound
    What it means: it names what actually happened
    Why it matters: a scene can be confirmed; a character trait cannot

* anchored
    What it means: it keeps their own words or a concrete action
    Why it matters: paraphrasing is where invention enters

* one line of reading
    What it means: judgement comes last and stays short
    Why it matters: the evidence stays intact and the interpretation is clearly separate

A badly formed entry has the opposite profile: adjective-first, undated, scene-free, nothing the reader could confirm or deny. A file full of those is what makes a person ask "why are you keeping notes on me?"

Template (structure only, no content): YYYY-MM-DD  <what happened>  — "<their words>"  — <one line of reading>.

If no scene and no quote come to mind, write nothing — an empty persona section beats an invented one.

------------------------------------------------------------------------

Install
-------

1. Manager exe (from Releases)

Download dsh-memory-manager.exe from the Releases (../../releases) page — it is not committed to this repository. It is a single unsigned file (~34 MB) that embeds the Node runtime; Windows SmartScreen may warn about it, and you can build it yourself with build-single-exe.ps1 if you prefer to compile the source. The first launch asks for the UI language (English / 简体中文 / 繁體中文), extracts the bundled runtime into %LOCALAPPDATA%\dsh-thirdparty-memory\, starts the memory page and opens it in your browser. A tray icon stays around:

Open memory page · Copy address · Storage location… · Open storage folder · Change port… · Restart/Stop service · Attach to DSH… · Language · Quit

    dsh-memory-manager.exe                     open the page, stay in the tray
    dsh-memory-manager.exe --install           attach the plugin to every detected DSH profile
    dsh-memory-manager.exe --start / --stop / --restart / --status
    dsh-memory-manager.exe --port 7900         custom port (refuses if the port is taken)
    dsh-memory-manager.exe --store D:\dsh-mem  custom storage folder (rules below)
    dsh-memory-manager.exe --lang zh-CN        switch UI language

2. Script

    powershell -ExecutionPolicy Bypass -File .\attach.ps1                 # all detected profiles
    powershell -ExecutionPolicy Bypass -File .\attach.ps1 -CreateWeb      # create a missing web profile too
    powershell -ExecutionPolicy Bypass -File .\attach.ps1 -Repair         # strip a UTF-8 BOM from every profile manifest
    powershell -ExecutionPolicy Bypass -File .\attach.ps1 -ProfileDir "C:\Users\you\.dsh\profiles\web"
    powershell -ExecutionPolicy Bypass -File .\attach.ps1 -DataFile "D:/dsh-mem/memory.json"
    powershell -ExecutionPolicy Bypass -File .\attach.ps1 -PluginDir "D:\plugins\dsh-thirdparty-memory"
    powershell -ExecutionPolicy Bypass -File .\attach.ps1 -RuntimeDir "C:\path\to\dsh\node_modules\@deepseek-ai" -Force

The script is idempotent ([skip] means "already fine"). It auto-detects every DSH home it can find (MSIX, portable, CLI), creates the junction, registers the bundle, writes the patch row and — with -RuntimeDir — points the plugin's dsh-tools peer at the host's copy. Without -DataFile, the script keeps whatever dataFile the patch already has — it no longer deletes that line, which used to move the store behind your back. -Repair only fixes manifests: it prints fixed=… clean=… invalid=… and exits.

3. Manual (four steps)

For a profile directory such as %APPDATA%\com.yeagoo.dsh-desktop\harness\profiles\web:

1. mklink /J "<profile>\node_modules\dsh-thirdparty-memory" "<plugin dir>" (or copy the folder)
2. add "dsh-thirdparty-memory" to dsh.profile.bundles in the profile's package.json
3. append to cordis.patch.yml:

       - id: thirdparty-memory
         name: dsh-thirdparty-memory
         config:
           enabled: true
           judgeMode: model
           inbox: true

4. give the plugin its peer: junction <plugin>\node_modules\@deepseek-ai\dsh-tools → the host's @deepseek-ai\dsh-tools

Restart DSH. Bundles are read at boot only. Afterwards Settings → Plugins lists dsh-thirdparty-memory, and the memory page is up at <http://127.5.0.1:7891/> (also served on 127.0.0.1, so <http://localhost:7891/> works too).

------------------------------------------------------------------------

Daily use
---------

    You:  remember: <one fact, plus the reason when the reason is not obvious>
          → stored immediately (explicit request), no review needed
    
    You:  [全局] <a rule that has to hold on every single turn>
          → injected on every turn from now on; global entries are the priciest bytes
    
    You:  <a task about topic A>, then <a task about topic B>
          → only the A and B entries are injected; everything else collapses into the index
    
    You:  extract every memory about <topic>
          → explicit recall: relevance threshold off, budget widened, whole batch delivered
    
    You:  forget entry 3 / update entry 9 to: <new text>
          → remember remove / remember update; numbering is shared with the page

Nothing to type for persona facts: the agent applies the four properties above by itself (judgeMode: model) and only records an entry once it has a date, a scene and your own words. If a note is wrong, delete it on the memory page — every deletion asks for a second confirmation.

------------------------------------------------------------------------

The memory page
---------------

<http://127.5.0.1:7891/> (also served on 127.0.0.1, so http://localhost:7891/ works too)

* 🧠 Memory Hub
    What it does: All entries with category filters, pin/unpin, delete (two-step confirm); click an entry → workbench drawer

* 📥 Inbox
    What it does: Auto-extracted persona facts; accept / edit / reject, individually or in bulk

* 📊 Token Dashboard
    What it does: Byte/token split per section, budget warnings, library KPIs

* 🔍 Search
    What it does: Keyword search over content, tags and project

* ⚙️ Settings
    What it does: Master switch, auto extraction, who decides what to remember, index on/off, injection parameters, language, export JSON

* 👁 Prompt preview
    What it does: The exact prompt a new chat would receive

------------------------------------------------------------------------

Configuration
-------------

Two layers, later wins: cordis.patch.yml (deployment) → memory page settings stored in the store (memory.sqlite).

* enabled
    Default: true
    Meaning: Hard switch. Off = no injection, no extraction, add fails.

* judgeMode
    Default: model
    Meaning: model = the agent decides what to remember · rules = built-in regex fallback · off = never auto-record

* autoExtract
    Default: true
    Meaning: Enables rule extraction when judgeMode: rules

* inbox
    Default: true
    Meaning: Every automatic write (inferred notes) is stored as pending and must be reviewed; false writes them directly as active. Explicit remember calls are unaffected.

* injectMode
    Default: relevant
    Meaning: relevant = keyword-selected · all = everything

* maxBytes
    Default: 8192
    Meaning: Injection byte budget

* maxRelevant
    Default: 6
    Meaning: Max matched entries per turn

* perCluster
    Default: 2
    Meaning: Entries per topic when several topics appear

* minScore
    Default: 6
    Meaning: Relevance threshold (higher = stricter)

* recallMaxBytes
    Default: 16384
    Meaning: Widened budget for explicit recall

* maxRecall
    Default: 40
    Meaning: Max entries returned by explicit recall

* showIndex
    Default: true
    Meaning: Include the numbered index of unselected entries

* indexChars
    Default: 18
    Meaning: Title length in the index

* currentProject
    Default: ""
    Meaning: Active project name (project entries become eligible)

* dataFile
    Default: ""
    Meaning: Memory path. Empty = %APPDATA%\dsh-thirdparty-memory\memory.sqlite. A .json path is accepted and maps to the same-name .sqlite beside it.

* vector
    Default: true
    Meaning: Local vector index on/off. false = keyword-only retrieval.

* vectorWeight
    Default: 1
    Meaning: Weight of the cosine bonus. 0 disables the bonus entirely.

* vectorMinCos
    Default: 0.3
    Meaning: Cosine floor; below it a match adds nothing (higher = stricter).

* pageServer / pageHost / pagePort
    Default: true / 127.5.0.1 / 7891
    Meaning: Memory page process

Storage rules

The manager enforces them whenever you change the folder (Storage location… or --store):

1. the drive must exist;
2. every folder name must be ASCII (A-Z a-z 0-9 space _ - .);
3. the target folder must be empty (or already your current store);
4. a bare drive root is refused.

If the old folder still holds memories the manager asks copy them over? — Yes copies, No switches only, Cancel aborts. After a switch, dataFile is written into every attached profile's cordis.patch.yml, so plugin and page keep reading the same store.

------------------------------------------------------------------------

Storage, vectors and updates
----------------------------

Where the data lives (0.4.0)

The store is a local SQLite database opened through Node's built-in node:sqlite — no native module, no npm install, no server. WAL mode is on, so the page server and the plugin do not block each other.

* dataFile accepts
    a .json path (kept for old configs) or a .sqlite path

* real database
    same folder, same base name: memory.json → memory.sqlite

* default (Windows)
    %APPDATA%\dsh-thirdparty-memory\memory.sqlite

* override the folder
    set DSH_THIRDPARTY_MEMORY_HOME

* no node:sqlite (Node < 22.5)
    automatic fallback to JSON storage at the same path; same features except vector retrieval

The default folder sits outside the plugin folder on purpose: updating the plugin replaces code, and a code update must never touch memories. Older versions kept the file at <plugin>\data\memory.json — exactly the place an update overwrites — so that file is now only a read-only migration source.

Existing users keep what they had: if the config already sets dataFile, 0.4.0 uses that path unchanged. Only a fresh install with no dataFile lands in the new default folder.

One-time JSON → SQLite migration: copy only

On the first read, when the .sqlite database does not exist yet but a JSON store does:

1. the JSON is copied to memory.json.bak_pre_sqlite_<ISO timestamp> in the same folder;
2. that copy is imported into the new database;
3. the original JSON is not modified, not deleted and not renamed.

It happens once; afterwards the database is the source of truth. The backup is the escape hatch: if the runtime ever changes, the JSON is still sitting there.

Local vector index

0.4.0 adds a small local vector layer, built offline and with zero dependencies:

- input: characters (1-, 2- and 3-grams) plus Latin words;
- every token is hashed with FNV-1a into 256 dimensions, TF-weighted, then L2-normalised;
- the vector is stored as a Float32 BLOB in the same database;
- retrieval score = keyword score + cosine bonus round(cos × 12 × vectorWeight); a pair below vectorMinCos adds nothing.

Be precise about what that buys you: it catches literal closeness — the same characters or words, a reordered sentence, a query that repeats part of an entry. It is not synonym-level semantics: shared characters and words, not shared meaning.

Key           Default  Meaning
------------------------------
vector        true     false = keyword-only retrieval
vectorWeight  1        multiplier for the cosine bonus; 0 disables it
vectorMinCos  0.3      cosine floor; lower = more (and looser) matches

Without node:sqlite there is no vector table, so retrieval is keyword-only — that is the single feature the fallback does not carry over.

Update safety

- Replacing the plugin folder only swaps code. An update does not overwrite, migrate, rename or delete any memory file.
- attach.ps1 keeps an existing dataFile. Without -DataFile it leaves the configured path alone; previously it dropped that line, which quietly moved the store.
- attach.ps1 -Repair scans every DSH profile's package.json, backs up any manifest that carries a UTF-8 BOM and rewrites it without one.
- Since 0.4.4 the default inbox covers every automatic write. After upgrading, notes the agent records on its own — the "lessons / pitfalls" it used to write straight in — now land in the review inbox as pending and are injected only after you accept them. Set inbox: false to restore the old direct-write behaviour. Explicit remember tool calls are unaffected and still write directly.

The BOM crash (fixed in 0.4.0)

Store/MSIX builds of DSH Desktop crashed on every start after install. Root cause: the profile's package.json had been written as UTF-8 with BOM; the host's readProfileManifest calls JSON.parse directly without stripping a BOM, so it threw SyntaxError: Unexpected token '\uFEFF' and exited with code 1 — and after three consecutive crashes the host stopped auto-restarting.

The fix: both installers (attach.ps1 and the manager exe) now write UTF-8 without a BOM, reading tolerates a BOM, and -Repair cleans up manifests that are already broken.

------------------------------------------------------------------------

0.4.4 fixes
-----------

0.4.4 is a correctness, hardening and release-engineering release on top of 0.4.3.
No storage or configuration change: replacing the plugin files is enough, and the
SQLite store and the JSON store are read exactly as before. The memory folder is
never touched by an upgrade.

Server semantics

- The master switch is a real gate. With enabled: false, every write route
  (entry/add, entry/update, entry/delete, inbox, inbox/bulk) answers
  409 MEMORY_DISABLED. /api/settings stays writable so the switch can be
  turned back on, and GET /api/state, /api/export, /api/preview keep
  working. The existing degraded-store 409 still takes precedence.
- inbox/bulk validates action. Only accept and reject are accepted;
  anything else answers 400.
- accept, reject and edit are three different operations. accept
  applies the submitted content / category / priority / project / tags /
  ttlDays and sets status: active; reject only sets status: rejected;
  edit applies the same field overrides but keeps the current status (a pending
  entry stays pending). Unknown actions answer 400.
- Length is checked before the write. An inbox accept/edit whose content is
  over 2048 bytes answers 400 and nothing is stored.
- Settings are validated before they are written. injectMode must be
  relevant / all and showIndex a boolean — anything else answers 400
  (with the current configuration echoed back) and nothing is stored.
  judgeMode only accepts model / rules / off, lang goes through
  normalizeLang, and the numeric keys (maxRelevant, minScore, maxBytes,
  maxEntries, indexChars, perCluster, recallMaxBytes, maxRecall) only
  accept finite values > 0 (stored as integers); values that fail those rules
  are ignored rather than written, so the settings can never end up
  half-applied.
- {reset: true} restores every default, including enabled, judgeMode,
  lang, perCluster, recallMaxBytes and maxRecall.
- /api/export is self-describing. The top level now also carries
  degraded (null when healthy), revision, dataFile and storage, so a
  snapshot can be judged without a second request.
- settings.overrides echoes the deployment layer. The same
  OVERRIDABLE_CONFIG_KEYS allow-list the page writes is read back (plus
  lang), so "what will actually be used" is visible in one place.
- 405 with Allow for a known path. A registered path called with an
  unsupported method answers 405 and lists the methods it supports;
  PATCH / DELETE and other unknown methods still answer 404.
- id and number are cross-checked. update / delete / inbox accept
  both; if the number now points at a different entry than the id, the request is
  refused with 409 MEMORY_CONFIRM_MISMATCH ("编号已变化，请刷新后重试") instead of
  changing the wrong memory.
- Duplicate detection is normalised. add compares
  normalizeForDedupe() forms (case-, whitespace- and punctuation-insensitive),
  so "Same  fact." and "same fact" are recognised as the same memory. The
  exact-equality behaviour used elsewhere is unchanged.
- sameFile() is platform-correct. Windows path comparison normalises
  separators and case; other platforms compare case-sensitively with forward
  slashes.

UI

- Invalid numbers are refused before the request. Saving settings validates
  maxBytes, maxRelevant, minScore, indexChars (and the other numeric
  fields) in place: the row shows an error, nothing is sent, and no success toast
  appears.
- Polling no longer overwrites unsaved edits. The 6-second refresh skips the
  settings panel while the form is dirty or focused; the rest of the page still
  updates.
- Export failures are visible. A failed export shows a toast instead of an
  unhandled promise rejection.
- Narrow screens are supported. A 720 px breakpoint folds the 224 px sidebar
  into a top bar and switches the grid to one column, so a 360 px wide window has
  no horizontal scroll.
- Statuses are localised. active / pending / rejected / archived go
  through t("status." + status), and archived has its own label and colour in
  the list and in the drawer.
- Category chips match the list. Chip counts exclude pending entries exactly
  like the list does, so the number on a chip equals the visible rows.
- The UI speaks the new server semantics. Update/delete/inbox requests send
  both id and number; 409 MEMORY_CONFIRM_MISMATCH shows "编号已变化，已刷新"
  and reloads; 409 MEMORY_DISABLED shows "记忆已关闭"; 400 shows the server's
  message and 404 keeps its old wording. Inbox accept sends the full field set
  and edit stays edit — it is never sent as accept.

Engine and rendering

- Every auto write lands in the inbox by default through
  autoWriteStatus(): inbox: false → active, otherwise pending (profile and
  explicit captures alike). The inbox configuration semantics are unchanged
  (default true).
- injectMode: all no longer leaks sessions. entriesForAllMode() drops
  ephemeral entries that belong to other sessions and keeps the current session's
  ephemeral entries as ephemeral; a second window or a subagent can no longer see
  another conversation's scratch notes.
- pluginBuildId() fails soft. When the source hash cannot be computed it
  caches unknown-<timestamp base36> (different per process) instead of throwing
  or returning an empty id.
- The page process is replaced on upgrade. The new process probes
  /api/health, compares the build identity and only then retires the old
  detached page server — previously a page started before an upgrade could keep
  serving old code forever.
- A failed JSON → SQLite migration leaves no half-created database, so the
  next read stays degraded (read-only) instead of accepting writes into an empty
  store. The backend cache key also includes the legacy source path, so
  storageInfo() before the first loadStore() can no longer skip the one-time
  migration.
- Rendering knows when to stay quiet. renderInjection() no longer prints a
  section header with no entries; the budget / omission logic is unchanged.
- Smaller fixes. storageInfo() reports the number of expired entries and
  parseTags() de-duplicates tags.

Release engineering

- attach.ps1 is back in the repository from the canonical copy, with no
  machine-specific paths; "route B" above lists exactly the flags it supports.
- The manager exe ships through GitHub Releases, not the repository. The
  README explains the unsigned single file and how to rebuild it
  (build-single-exe.ps1). The stale dsh-memory-manager.exe entry was removed
  from the npm files list because the artifact is git-ignored and build-made.
- The manager source matches the binary. manager/DshMemoryManager.cs is the
  0.4.3-era source (default store under %APPDATA%, legacy-folder detection,
  remembering the last store) with Version = "0.4.4"; the stale 0.4.0 copy is
  gone.
- CI runs the real suites. .github/workflows/syntax.yml keeps
  node --check and the export smoke test and adds
  tests/core-audit/run-all.mjs and tests/http-audit.mjs, each followed by a
  gate. tests/static-audit.mjs is deliberately manual — see below.
- One address everywhere. The default is 127.5.0.1:7891 and the server also
  binds 127.0.0.1; the three languages and the tutorials say exactly that.

Verification

Measured on Windows 10/11 with Node 24.21.0 (node:sqlite available), against an
isolated store and port — the real store is not touched:

* tests/core-audit/run-all.mjs
    Result: 220/220 checks green (12 files)
    Notes: CRUD, numbering, TTL, migration, backup retention, degraded states, concurrency, WAL

* tests/http-audit.mjs
    Result: 67/67
    Notes: 0.4.5 fixed the audit's own three test-side defects (A37's count assumption, B5's outdated assertion, A44c ignoring the node:sqlite ExperimentalWarning); it also exits non-zero on a real failure now

* tests/static-audit.mjs
    Result: 25/27
    Notes: S26/S27 are known false positives; run manually, not in CI

* tests/regression-0.4.4.mjs
    Result: 16/16
    Notes: acceptance cases written for the 0.4.4 batch

The A37 / B5 test-side defects that used to keep two checks red were fixed in
0.4.5 (A37's touched count now follows the pending count captured before the
call; B5 now requires the safer degraded field, matching A2c; A44c ignores
Node's experimental/deprecation warnings). The suite reports 67/67 and the CI
allow-list for A37/B5 was removed.

Known test-side issues (not product defects):

- S26/S27 (static audit) scan only core.js and therefore claim that
  injectMode and maxEntries are never consumed — they are consumed in
  index.js. That is why the static suite is not part of CI.

0.4.3 fixes
-----------

0.4.3 is a correctness release on top of 0.4.2. No storage or configuration change: replacing the plugin files is enough, and the SQLite store and the JSON store are read as before.

The concurrency defect: one snapshot per read

readStore read the entry rows and the revision counter in two separate statements. The DSH host and the memory page are always two writers, so when one committed between those statements the other read old entries together with a new revision; the optimistic lock then saw a matching revision and let the write through, deleting the entry that had just been added — with no error anywhere. Reproduced with four processes writing 25 entries each: revision reached 101 while the table held 100. readStore now wraps rows, settings and revision in one read transaction (BEGIN … COMMIT).

storageInfo() no longer creates an empty database

The status call used by the memory page opened the SQLite file to read its counters. Opening a missing path creates an empty database, which silently disabled the "database lost + migration sentinel" degraded state after one page refresh: the next read saw an ordinary empty store and accepted writes. storageInfo() now leaves a missing file alone and reports zeros.

Injection follows the right conversation

The latest user message was cached in one process-wide variable. Any session — a second window or a subagent — overwrote it, so one conversation's injection was selected by another conversation's text (observed: the main session asked about a plugin bug, a subagent mentioned a different project, and the main session's injection switched to that project's memories). The cache is now per session; each prompt assembly looks up its own session through the assembly context (scope.session.id), and the process-wide fallback only accepts top-level sessions.

Deleting by number re-checks the target

remember remove echoes the entry first and deletes on the second call with confirm=true. If a write in between shifted the numbering, the confirmed number pointed at a different entry and the wrong memory was deleted (reproduced: preview #2, delete #1, confirm #2 — the entry that had been #3 was deleted). The preview records the entry id per number; a confirm that resolves to a different id is refused with MEMORY_CONFIRM_MISMATCH and asks for a fresh preview. Deleting by id is unaffected.

Smaller fixes

- ephemeral entries were stored with an empty sessionId, so the category could never match the running session and was never injected. The session now comes from the tool call itself (exec.agent.session.id).
- A request body over 128 KB ended in a connection reset instead of the intended 413, because the handler destroyed the socket before answering. It now answers 413 and drains the body.
- One corrupted character in a server.js comment was replaced.

Verification at the time (the original 0.4.3 count, kept for the record): core-layer and HTTP regression suites (39 + 30 checks) against an isolated store and port; four-process concurrency over three rounds (101 entries and revision 101 each round); database-loss, corrupt-database, JSON-migration, backup and numbering checks; memory page rendered in headless Edge with no untranslated keys and no XSS in entry content. The real store was left untouched (59 entries before and after; WAL 0 bytes). The suites have grown since: current totals are 220 core checks, 67 HTTP checks and 27 static checks (see Verification under 0.4.4 fixes (#044-fixes)).

0.4.2 maintenance fixes
-----------------------

- POST /api/entry/delete requires confirm: true, the same rule the command line has enforced since 0.4.1. Without it the endpoint answers 409; deleting an entry that is already gone answers 404.
- storageInfo reports the real revision, last backup time and vector count. It used to read them from a database handle that had not been opened yet, so a fresh process always reported zeros and the memory page always claimed there was no backup.
- Bulk deletion stays intentionally absent. An unreleased draft of 0.4.2 had a WIPE-gated endpoint and a settings button; both were withdrawn before release. Delete entries one at a time — the page asks twice every time.
- Regression pass over every endpoint and a 5000-entry performance check.

0.4.1 data-safety fixes
-----------------------

0.4.1 fixes a set of data-safety defects in 0.4.0's SQLite storage. Each item below changes behaviour you can observe.

Checkpoint after every write

Every write ends with PRAGMA wal_checkpoint(TRUNCATE), merging the WAL back into memory.sqlite. The main file now carries all the data instead of staying a 4 KB shell whose content sits in the -wal file. Copying or backing up memory.sqlite alone is enough to read every memory; under 0.4.0 the same copy produced 0 entries and no error.

-wal / -shm still appear while a process has the database open. They are runtime files, not part of a backup.

A failed read degrades instead of falling back

If the SQLite database cannot be read, the plugin no longer falls back to the old memory.json snapshot. It enters a degraded state: the injected section starts with a visible warning naming the reason and the database path, the memory page shows the same warning, and writes are refused (MEMORY_DEGRADED), so a stale snapshot cannot overwrite the live database.

Migration sentinel: memory.sqlite.migrated

A completed migration writes a sentinel file next to the database. If that database is later lost, the plugin will not rebuild a store from the old JSON — the sentinel records that the store was already migrated and the JSON is history. To run a migration again on purpose, delete the sentinel file.

Automatic backups

On the first write of each day the plugin creates a snapshot with VACUUM INTO at <store folder>\backups\memory-<timestamp>.sqlite. The file is self-contained (no -wal dependency) and the most recent 30 are kept.

Optimistic locking on writes

Writes replace the whole store, so the DSH host and the memory page writing at the same time used to lose one side's entry. Each write now checks the revision counter in the SQLite meta table; on a mismatch it re-reads and replays the change instead of overwriting it.

remember tool fixes

- remove requires a second confirmation: the first call only echoes the entry, and the second call with confirm=true performs the deletion.
- search now prints global entry numbers. Until 0.4.1 it printed the hit's position in the result list, so reading an entry by that number returned a different one.
- update enforces the 2048-byte content limit, as add already did.

Behaviour fixes

- status=archived stays archived instead of being silently rewritten to active.
- A global entry can be unpinned; global no longer forces pinned.
- A 画像 tag is no longer silently dropped from an entry's tags.

------------------------------------------------------------------------

Data
----

Storage is SQLite — see Storage, vectors and updates (#storage-vectors-and-updates) for the paths, the migration and the update rules. The JSON document below is the fallback format the plugin reads and writes when node:sqlite is unavailable. GET /api/export returns the same shape, with degraded, revision, dataFile and storage added at the top level since 0.4.4:

    {
      "version": 2,
      "entries": [
        {
          "id": "mem-xxxx", "content": "<the fact, one self-contained sentence>",
          "category": "global", "project": "", "priority": "high",
          "tags": ["<tag>"], "source": "user", "status": "active",
          "pinned": true, "expiresAt": null, "sessionId": "",
          "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"
        }
      ],
      "settings": { "enabled": true, "lang": "en" }
    }

status: active · pending (inbox) · rejected. Version-1 files migrate automatically (a [全局] prefix becomes category: "global"). The SQLite schema is an implementation detail — read the store through the page or the API, not with SQL.

------------------------------------------------------------------------

HTTP API
--------

* GET
    Path: /
    Purpose: memory page

* GET
    Path: /api/state?q=
    Purpose: state + entries + dashboard

* GET
    Path: /api/export
    Purpose: download JSON

* POST
    Path: /api/entry/add · /update · /delete
    Purpose: entry CRUD (one delete at a time, by design)

* POST
    Path: /api/inbox · /api/inbox/bulk
    Purpose: accept / reject / edit (bulk accepts accept / reject only)

* POST
    Path: /api/settings
    Purpose: write user-layer settings ({reset:true} restores defaults)

* POST
    Path: /api/preview
    Purpose: render the injection for a given q

Loopback only. The Host header must name a loopback address (or the configured pageHost) and, when it carries a port, the configured port — otherwise the server answers 421 Misdirected Request, which blocks DNS-rebinding pages. POST requires application/json, which blocks cross-site form posts. A registered path called with an unsupported method answers 405 plus an Allow header; PATCH / DELETE and other unknown methods answer 404. Writes on a store whose master switch is off answer 409 MEMORY_DISABLED (settings stay writable).

------------------------------------------------------------------------

Troubleshooting (short list — full table in the tutorial)
---------------------------------------------------------

* Nothing happens after install
    Cause / fix: DSH was not restarted; bundles load at boot only

* DSH Desktop exits with code 1 right after install, three times, then stops restarting
    Cause / fix: the profile's package.json carries a UTF-8 BOM; run attach.ps1 -Repair, then restart DSH

* Memories "disappear" after updating the plugin
    Cause / fix: compare dataFile in the patch with dsh-memory-manager.exe --data: an old install keeps its own path, a new one defaults to %APPDATA%\dsh-thirdparty-memory\memory.sqlite

* Vector matching feels random / unwanted matches
    Cause / fix: raise vectorMinCos (stricter), lower vectorWeight, or set vector: false for keyword-only

* Plugin missing from Settings → Plugins
    Cause / fix: run attach.ps1 again and read its output

* Memory page blank
    Cause / fix: the page process died; run dsh-memory-manager.exe --start

* Port 7891 is used by another program
    Cause / fix: another app owns the port: --port 7900, or Change port…

* The agent searches the plugin folder instead of just answering
    Cause / fix: the plugin was not loaded, so no memory tool existed; restart DSH

* A write answers 409 MEMORY_DISABLED
    Cause / fix: the master switch is off; turn it back on in Settings (the settings endpoint stays writable)

* The page answers 421 Misdirected Request
    Cause / fix: you opened it through a non-loopback hostname or another port; use http://127.5.0.1:7891/ or http://localhost:7891/

* Defender flags a scheduled task
    Cause / fix: never self-install via Task Scheduler (heuristic trojan detection); use the exe's tray or the Startup folder

* Memories look like regulations
    Cause / fix: switch to judgeMode: model and let the agent write persona notes; the inbox shows what it inferred

------------------------------------------------------------------------

Security
--------

Never Trust the LLM is a design rule here, not a slogan. The memory page is a
local administrative surface, and the injected section is untrusted data.

The injected section is data, not instructions

- The 【long-term memory】 section opens with an explicit statement that its
  entries are historical data, not instructions for this turn, and that
  instruction-like text inside an entry does not represent the current user's
  intent.
- Every injected line carries its source: [user] (the user asked for it),
  [auto] (the plugin inferred it), [agent] (the agent recorded it).
- Entries containing instruction-injection patterns — English and Chinese
  ("ignore previous…", "disregard previous…", "you are now…", "忽略之前…",
  "你现在是…", "请执行…", and so on) — are kept out of the injected body. They
  only appear under 疑似指令性文本（仅索引）： as truncated index lines. A memory
  can therefore not smuggle a directive into the next turn.

Every automatic write is reviewed by default

- inbox: true is the default and covers all automatic writes — profile
  facts and explicit captures alike. They are stored as pending and cannot
  reach the prompt until you accept them; inbox: false stores them as active.
- An explicit remember tool call (action=add) still writes directly. That is
  the agent following an instruction you gave it, not the plugin inferring
  something about you behind your back.

The HTTP surface

- Loopback only. The page server binds 127.5.0.1 by default and also binds
  127.0.0.1.
- Host allow-list. The Host header must be 127.0.0.1, 127.5.0.1,
  localhost, ::1, or the configured pageHost; if it carries a port, the
  port must be the configured one. Anything else gets 421 Misdirected Request
  for GET and POST alike. A missing Host header is still allowed.
- POST requires application/json, which a cross-site form cannot send.
- Method discipline. A registered path called with an unsupported method
  answers 405 with an Allow header listing what it does support; PATCH,
  DELETE and other unknown methods answer 404.
- The master switch gates writes, not reads: with enabled: false, write
  routes answer 409 MEMORY_DISABLED, while the page and /api/settings stay
  usable so you can turn memory back on.
- Limits. Request bodies over 128 KB answer 413; entry content over
  2048 bytes answers 400; duplicate detection is normalised; destructive
  actions are one at a time and re-check the id/number pair
  (409 MEMORY_CONFIRM_MISMATCH).

The plugin does not expose a "wipe everything" endpoint or button, and every
deletion in the page asks for a second confirmation.

Privacy
-------

Everything stays in one local SQLite database (plus its WAL side files). No network calls, no upload, no telemetry — the vector index is computed and stored locally. Memories do enter the model context — never store secrets. Destructive actions require two confirmations, and bulk deletion is intentionally not implemented: delete entries one by one.

------------------------------------------------------------------------

Compatibility
-------------

Host                                  Status
--------------------------------------------
DSH Desktop (MSIX, desktop 0.2.x)     tested
DeepSeek Harness portable (Electron)  tested (remember list / search verified)
CLI dsh web                           composition verified via --dump-config

Storage needs node:sqlite (Node 22.5+). On an older host runtime the plugin automatically falls back to JSON storage and keeps working; only vector retrieval is unavailable.

The plugin deliberately has no schemastery dependency (its Config implements the Standard Schema ~standard contract), so it survives across DSH release lines; the only peer it needs is @deepseek-ai/dsh-tools.

------------------------------------------------------------------------

Build from source
-----------------

    :: rebuild the single-file manager (needs .NET Framework 4.x csc.exe + a node.exe)
    powershell -ExecutionPolicy Bypass -File build-single-exe.ps1
    
    :: package release\dsh-thirdparty-memory-<version>.zip (includes a personal-path leak check)
    powershell -ExecutionPolicy Bypass -File build-release.ps1
    
    :: regenerate the plain-text docs after editing the Markdown
    node tools/md2txt.mjs README.md README.zh-CN.md README.zh-TW.md docs/tutorial.md docs/tutorial.zh-CN.md docs/tutorial.zh-TW.md
    
    :: run the audits locally (CI runs the first two; the static one is manual)
    node tests/core-audit/run-all.mjs
    node tests/http-audit.mjs
    node tests/static-audit.mjs

CI (.github/workflows/syntax.yml) runs node --check, the export smoke test,
tests/core-audit/run-all.mjs and tests/http-audit.mjs. tests/static-audit.mjs
is not in CI because of the two known false positives described in
0.4.4 fixes (#044-fixes); run it by hand with the command above. Beyond that,
the suites need no dependencies and never touch the real store.

------------------------------------------------------------------------

License
-------

MIT — see LICENSE. The bundled Node.js runtime is redistributed under its own MIT license (see docs/NODE-LICENSE.txt).
