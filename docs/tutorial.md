# DSH Third-Party Long-Term Memory Plugin (Unofficial) — Complete tutorial

> **Not affiliated.** Independent third-party open-source project. Not associated with DeepSeek, Doubao or their official teams; no authorisation or endorsement. Names are used only to describe compatibility.

English root copy. 简体中文: [`tutorial.zh-CN.md`](tutorial.zh-CN.md) · 繁體中文: [`tutorial.zh-TW.md`](tutorial.zh-TW.md).
Plain-text versions ship alongside every language (`tutorial.txt`, `tutorial.zh-CN.txt`, `tutorial.zh-TW.txt`).

Version: **0.4.4 (2026-11-12)**.
> Contact: Due to network conditions, I do not check GitHub often. Please reach me via mainland China social platforms: Douyin (not TikTok) Steelgang, or QQ 2278998874. Please communicate in English or Simplified Chinese. When adding me, please follow the format: GitHub username + project name + purpose. Please communicate on UTC+8 (China Standard Time), otherwise I may not receive your messages.


This tutorial is written to be the only document you need: install, configure, use it every day, and fix it when something breaks.

---

## 0. What you are actually running

Four moving parts. Knowing which one is broken is 90% of troubleshooting.

| Part | Lives where | What it does | How to restart |
| --- | --- | --- | --- |
| **Plugin** (`index.js` + `core.js`) | inside a DSH profile, loaded by the Cordis loader | injects the 【long-term memory】 section, registers the `remember` tool, listens to conversation events | **restart DSH** (bundles load at boot only) |
| **Memory page server** (`server.js` + `ui.html` + `core.js`) | a standalone `node` process | serves <http://127.5.0.1:7891/> (also on `127.0.0.1`), reads/writes the same store | `dsh-memory-manager.exe --restart`, or tray ▸ Restart |
| **Manager exe** (`dsh-memory-manager.exe`) | wherever you put it | extracts the bundled runtime, starts/stops the page server, tray menu, storage & port & language settings | just relaunch it |
| **Store** (SQLite `memory.sqlite`, JSON fallback) | `dataFile` (default `%APPDATA%\dsh-thirdparty-memory\memory.sqlite`, or your chosen storage folder) | the single source of truth both the plugin and the page read | no restart needed; every operation re-reads the store |

Two rules that explain most confusion:

1. **The page and the plugin are independent processes.** The page can be up while the plugin is not loaded (the agent then has no memory tool), and the plugin can be loaded while the page is down (the agent still has memories; only the UI is missing).
2. **Only the store is shared state.** If the page shows 0 entries while the agent "remembers things", they are reading two different files — see §3.4.

---

## 1. Install

### 1.1 Before you start

* Windows 10/11.
* Any DSH host already installed: DSH Desktop (MSIX), the DeepSeek Harness portable build, or the CLI (`dsh`).
* Nothing else. No Node install needed if you use the exe (it ships Node 24); with the script/manual route, Node 18+ must be resolvable. SQLite storage needs `node:sqlite` (Node 22.5+); on an older runtime the plugin falls back to JSON.

Find your profile(s) first — the plugin attaches to a **profile**, not to "DSH" in the abstract:

```
%APPDATA%\com.yeagoo.dsh-desktop\harness\profiles\web     ← DSH Desktop (MSIX), booted by `dsh web`
%USERPROFILE%\.dsh\profiles\web                           ← CLI / portable builds
%USERPROFILE%\.dsh\profiles\desktop                       ← older desktop-style profile
```

A profile is just a folder containing `package.json`, `cordis.patch.yml`, `cordis.yml` and `node_modules`. `dsh web` means "boot the profile named `web`".

### 1.2 Route A — the manager exe (recommended)

1. Download `dsh-memory-manager.exe` from the [Releases](../../../releases) page (it is not committed to this repository) and put it anywhere writable (e.g. `D:\tools\`). It is a single ~34 MB **unsigned** file; Windows SmartScreen may warn about it, and `build-single-exe.ps1` rebuilds it from source if you prefer. Nothing else is required.
2. Double-click it.
   * **First run** asks for the UI language → English / 简体中文 / 繁體中文. The choice is written to `%LOCALAPPDATA%\dsh-thirdparty-memory\config.json` and stays until you change it (tray ▸ Language).
   * It extracts the bundled Node runtime and the app files into `%LOCALAPPDATA%\dsh-thirdparty-memory\`, starts the page server and opens <http://127.5.0.1:7891/>.
   * A tray icon appears: `Open memory page`, `Copy address`, `Storage location…`, `Open storage folder`, `Change port…`, `Restart service`, `Stop service`, `Attach to DSH…`, `Open install folder`, `Language`, `Quit`.
3. Tray ▸ **Attach to DSH…** (or run `dsh-memory-manager.exe --install`). For every profile it finds it creates a junction, registers the bundle, writes the patch entry and points the plugin's `dsh-tools` peer at the host's copy.
4. **Restart DSH.**
5. Verify:
   * DSH ▸ *Settings → Plugins* lists `dsh-thirdparty-memory` (entry id `thirdparty-memory`, mounted);
   * open a new chat and ask "what do you remember about me?" — it should answer from the injected section rather than hunting the disk;
   * the memory page shows the same entries the agent can see.

CLI equivalents:

```bat
dsh-memory-manager.exe --install                    :: attach + start + open
dsh-memory-manager.exe --start                      :: start the page server only
dsh-memory-manager.exe --stop                       :: stop the page server
dsh-memory-manager.exe --status                     :: 0 healthy · 1 not running · 3 port owned by another app
dsh-memory-manager.exe --port 7900                  :: remember a new port (refused if taken)
dsh-memory-manager.exe --store "D:\dsh-memory-data" :: remember a new storage folder
dsh-memory-manager.exe --lang zh-TW                 :: switch UI language
dsh-memory-manager.exe --dir / --data / --version   :: show install dir / data file / version
```

### 1.3 Route B — `attach.ps1`

```powershell
# every profile it can find (MSIX + portable + CLI homes)
powershell -ExecutionPolicy Bypass -File .\attach.ps1

# also create a `web` profile in any home that lacks one
powershell -ExecutionPolicy Bypass -File .\attach.ps1 -CreateWeb

# one specific profile
powershell -ExecutionPolicy Bypass -File .\attach.ps1 -ProfileDir "C:\Users\you\.dsh\profiles\web"

# repair: strip a UTF-8 BOM from every profile's package.json (they crash DSH Desktop)
powershell -ExecutionPolicy Bypass -File .\attach.ps1 -Repair

# keep the store outside the plugin folder (recommended: an ASCII path)
powershell -ExecutionPolicy Bypass -File .\attach.ps1 -DataFile "D:/dsh-memory-data/memory.json"

# point the plugin's dsh-tools peer at a specific runtime (multi-release setups)
powershell -ExecutionPolicy Bypass -File .\attach.ps1 -RuntimeDir "D:\harness\node_modules\@deepseek-ai" -Force
```

The script is idempotent: `[skip]` means "already fine". It prints one line per change, and ends with `done: N/M profile(s) attached`.

Two behaviours worth knowing:

* **`-DataFile` is optional.** Without it the script keeps the `dataFile` already present in the patch instead of deleting the line (older versions removed it, which silently moved the store).
* **`-Repair` exits after fixing manifests.** It prints `repair done: fixed=… clean=… invalid=…` and does not attach anything; run the normal command afterwards. Every manifest it rewrites is first copied to `package.json.bak_bom_<timestamp>`.

### 1.4 Route C — manual, four steps

Given a profile directory `P`:

1. Link the plugin:
   ```bat
   mklink /J "P\node_modules\dsh-thirdparty-memory" "D:\plugins\dsh-thirdparty-memory"
   ```
   (copying the folder works too; a junction just keeps edits in one place.)
2. Register the bundle — in `P\package.json`, `dsh.profile.bundles` must contain `"dsh-thirdparty-memory"`.
3. Write the loader patch — append to `P\cordis.patch.yml`:
   ```yaml
   - id: thirdparty-memory
     name: dsh-thirdparty-memory
     config:
       enabled: true
       judgeMode: model
       inbox: true
   ```
   If the file only contains `[]`, replace that line — a bare `[]` plus a mapping is invalid YAML.
4. Peer dependency — the plugin imports `@deepseek-ai/dsh-tools` from the host:
   ```bat
   mklink /J "<plugin>\node_modules\@deepseek-ai\dsh-tools" "<host>\node_modules\@deepseek-ai\dsh-tools"
   ```

Then restart DSH.

> **Why step 4 exists:** the plugin's real path may sit on another drive, so Node's parent-directory walk never reaches `$DSH_HOME\profiles\node_modules` (the fallback DSH maintains for in-box packages). The junction makes the peer resolvable without duplicating it.

### 1.5 First-run checklist

```
[ ] memory page opens on http://127.5.0.1:7891/ (http://127.0.0.1:7891/ also works)
[ ] Settings → Plugins shows dsh-thirdparty-memory as mounted
[ ] a new chat can list memories (ask: "list my memories")
[ ] the page and the agent see the same number of entries
[ ] tray ▸ Storage location shows the folder you expect
[ ] the store file exists there (default: `memory.sqlite`)
```

---

## 2. Configure

### 2.1 Two configuration layers

| Layer | File | Wins over |
| --- | --- | --- |
| Deployment | profile `cordis.patch.yml` (`- id: thirdparty-memory` block) | the plugin's own defaults |
| User | the store → `settings` (written by the memory page) | deployment, for whitelisted keys |

Whitelisted keys a user-layer setting may override: `injectMode`, `judgeMode`, `maxRelevant`, `perCluster`, `minScore`, `showIndex`, `indexChars`, `maxBytes`, `maxEntries`, `recallMaxBytes`, `maxRecall`, `currentProject`. Switches (`enabled`, `autoExtract`) are also layered: **YAML off = hard off** (the page switch cannot turn it back on), page off = soft off.

### 2.2 Every key, and when to change it

| Key | Default | Change it when |
| --- | --- | --- |
| `enabled` | `true` | You want a global kill switch (e.g. a sensitive session) |
| `judgeMode` | `model` | `rules` if you want zero-token extraction; `off` if you want only explicit requests |
| `autoExtract` | `true` | Only meaningful with `judgeMode: rules` |
| `inbox` | `true` | Covers **all** automatic writes: `true` stores them as pending in the review inbox, `false` stores them active. Explicit `remember` calls are unaffected |
| `injectMode` | `relevant` | `all` if you have very few memories and want them always visible |
| `maxBytes` | `8192` | Lower for cheap models / long contexts; raise if you have many project facts |
| `maxRelevant` | `6` | Raise when your questions span many topics |
| `perCluster` | `2` | Raise when one sentence names 3–4 things |
| `minScore` | `6` | Raise (8–10) if unrelated memories keep showing up; lower (4) if relevant ones are missed |
| `recallMaxBytes` | `16384` | Raise if "extract everything about X" still truncates |
| `maxRecall` | `40` | Raise for very large libraries |
| `showIndex` | `true` | `false` saves bytes but the model can no longer discover unselected entries |
| `indexChars` | `18` | `10–12` for cheaper indexes, `24+` for more recognisable titles |
| `currentProject` | `""` | Set it while you work inside one project so its memories are eligible without naming it |
| `dataFile` | `""` | Store path. Empty = `%APPDATA%\dsh-thirdparty-memory\memory.sqlite`; a `.json` path maps to the same-name `.sqlite` |
| `vector` | `true` | Local vector index; `false` = keyword-only retrieval |
| `vectorWeight` | `1` | Weight of the cosine bonus (`0` disables it) |
| `vectorMinCos` | `0.3` | Cosine floor; below it a match adds nothing (higher = stricter) |
| `pageServer` | `true` | `false` if you manage the page yourself |
| `pageHost` / `pagePort` | `127.5.0.1` / `7891` | Port collisions, or you prefer `127.0.0.1` |

Three ready-made profiles:

```yaml
# Minimal — few memories, cheapest prompt
config: { enabled: true, judgeMode: model, injectMode: all, maxBytes: 4096, showIndex: false }

# Balanced (default)
config: { enabled: true, judgeMode: model, injectMode: relevant, maxBytes: 8192, maxRelevant: 6, minScore: 6, showIndex: true }

# Long-context / many projects
config: { enabled: true, judgeMode: model, injectMode: relevant, maxBytes: 16384, maxRelevant: 10, perCluster: 3, minScore: 5,
          recallMaxBytes: 32768, indexChars: 24, currentProject: 'my-project' }
```

### 2.3 Port

* Default `127.5.0.1:7891`, and the server also binds `127.0.0.1` so `localhost:7891` works.
* Change it: tray ▸ **Change port…**, or `--port 7900`, or `pagePort` in the patch, then restart the page.
* **Occupied ports are refused, not hijacked.** The manager distinguishes "my own server" (reuses it) from "someone else's" (exit code `3` + a message). If you point it at a port a different app owns, nothing starts and nothing is killed.
* Changing the port restarts only the page server; the DSH plugin is unaffected (it does not use the port).

### 2.4 Storage folder

Rules (enforced by the manager):

1. the drive must exist;
2. every folder name must be ASCII: `A-Z a-z 0-9` plus space `_` `-` `.`;
3. the target must be empty, or already be your current store;
4. a bare drive root (`D:\`) is rejected.

Change it with tray ▸ **Storage location…** or `--store <dir>`. If the old folder still has memories you are asked:

```
The old folder still holds N memories:
  D:\old\memory.json
Copy them into the new folder?
  Yes = copy      No = switch only (old data stays)      Cancel = abort
```

After a successful switch the manager writes `dataFile` into every attached profile's `cordis.patch.yml` — **restart DSH** so the plugin follows. The page server is restarted automatically.

> Keep the store in an ASCII path. Windows tolerates Chinese/Unicode folders, but `wscript`, PowerShell 5.1 script files and some launchers mangle them; keeping the data path plain ASCII removes a whole class of failures.

The folder now holds `memory.sqlite` (plus `-wal` / `-shm` companions while the page is running). A `memory.json` sitting next to it is no longer live data: it is the read-only source that the first 0.4.0 start was migrated from, and the plugin never edits it. Since 0.4.1 every write ends with a WAL checkpoint, so `memory.sqlite` alone is the complete store; the `-wal` file is a runtime file that is merged back after each write.

### 2.5 Language

* Chosen once at install time (first launch modal), stored in `config.json.lang`.
* Switch any time: tray ▸ **Language**, or `--lang en|zh-CN|zh-TW`, or the memory page ▸ Settings ▸ Language.
* The manager mirrors the choice into the store's `settings.lang`; the page server injects it into the HTML (`window.__DSH_MEMORY_LANG__`), so both stay in sync.
* Docs follow the same set: `README.md` (English root), `README.zh-CN.md`, `README.zh-TW.md`, and the tutorial in all three, each as `.md` and `.txt`.

### 2.6 Where the data file is

Since 0.4.0 the store is a SQLite database: same folder, same base name as `dataFile`, extension `.sqlite`. `memory.json` in a config becomes `memory.sqlite` next to it.

```
%APPDATA%\dsh-thirdparty-memory\memory.sqlite        ← default for a fresh install
D:\dsh-memory-data\memory.sqlite                     ← wherever dataFile points
<plugin>\data\memory.json                            ← legacy: read-only migration source
```

```bat
:: print the store path the manager uses
dsh-memory-manager.exe --data

:: move the default folder (set before DSH starts; the page and the plugin read it at boot)
set DSH_THIRDPARTY_MEMORY_HOME=D:\dsh-memory-data
```

`--data` prints the store path the manager is configured with; the live database is that path with a `.sqlite` extension, or JSON at the same path when `node:sqlite` is unavailable.

Rules of thumb:

* `dataFile` is the only thing that decides the location. Set it in `cordis.patch.yml` (or with `-DataFile`) if you want the store somewhere specific.
* `DSH_THIRDPARTY_MEMORY_HOME` only overrides the **default** folder — an explicit `dataFile` still wins.
* The fallback: on a host whose Node is older than 22.5 there is no `node:sqlite`, and the plugin keeps a JSON store at the same `dataFile` path instead. Same features, minus vector retrieval.

### 2.7 Upgrading: what changes and what does not

```bat
:: 1. replace the plugin folder (or unpack the new exe), keep your data folder as-is
:: 2. re-run the installer - it also repairs BOM-broken manifests
powershell -ExecutionPolicy Bypass -File .\attach.ps1 -Repair
powershell -ExecutionPolicy Bypass -File .\attach.ps1
:: 3. restart DSH
```

What an update does **not** do: it does not overwrite, migrate, rename or delete any memory file — it swaps code only.

What the first 0.4.0 start does, once:

1. if the configured store has no `.sqlite` yet but a JSON file exists, the JSON is copied to `memory.json.bak_pre_sqlite_<ISO timestamp>`;
2. the copy is imported into the new database;
3. the original JSON stays exactly where it was.

Former 0.3.x users keep their `dataFile` unchanged. The old `<plugin>\data\memory.json` is only read once, as a migration source, because that folder is what an update replaces.

### 2.8 The vector index, and how to tune it

0.4.0 adds a local vector layer so a question can match an entry that says almost the same thing in a different order.

| Stage | What happens |
| --- | --- |
| tokenise | characters (1/2/3-grams) + Latin words |
| hash | FNV-1a into 256 dimensions |
| weight | TF weighting, then L2 normalisation |
| store | Float32 BLOB in the same SQLite database |
| score | keyword score + `round(cos × 12 × vectorWeight)`; below `vectorMinCos` nothing is added |

**What it is not:** synonym-level semantics. It only sees shared characters or words — no meaning model, no embeddings service, no network access.

Keys (deployment layer — put them in `cordis.patch.yml`, then restart DSH):

```yaml
- id: thirdparty-memory
  name: dsh-thirdparty-memory
  config:
    vector: true             # false = keyword-only retrieval
    vectorWeight: 1          # 0 disables the cosine bonus entirely
    vectorMinCos: 0.3        # raise (0.45) for stricter matches, lower for looser
```

Practical tuning:

* unrelated memories keep matching → raise `vectorMinCos` to `0.4`–`0.5`;
* relevant memories are missed although the words overlap → lower `vectorMinCos` or raise `vectorWeight` to `2`;
* cost is not an issue here: the index lives next to the entries and adds no token cost, it only changes which entries are selected.

### 2.9 DSH Desktop exits with code 1 right after install (the BOM crash)

Symptom: Store/MSIX DSH Desktop closes immediately after the post-install restart, restarts itself twice, then stops.

Cause: the profile's `package.json` was written as UTF-8 **with BOM**. The host's `readProfileManifest` runs a bare `JSON.parse`, which throws `SyntaxError: Unexpected token '\uFEFF'`, the app exits with code `1`, and after three consecutive crashes it gives up auto-restarting.

```bat
:: fix every detected profile manifest (backs up before rewriting)
powershell -ExecutionPolicy Bypass -File .\attach.ps1 -Repair
:: output: repair done: fixed=N clean=N invalid=N
```

Then start DSH again. A repaired file is first copied to `package.json.bak_bom_<timestamp>`. 0.4.0 installers write manifests without a BOM, so new installs cannot hit this.

### 2.10 0.4.1 data-safety fixes

0.4.1 fixes a set of data-safety defects in 0.4.0's SQLite storage.

**Checkpoint after every write.** Every write ends with `PRAGMA wal_checkpoint(TRUNCATE)`, merging the WAL back into `memory.sqlite`. The main file holds all the data instead of staying a 4 KB shell, so backing up that one file is enough; copying only the main file under 0.4.0 produced 0 entries with no error.

**Degraded instead of silent fallback.** An unreadable database no longer falls back to the old `memory.json`. The store is marked `degraded`: the injected section and the memory page both display a warning with the reason and the database path, and writes are refused, so an outdated snapshot cannot overwrite the live database.

**Migration sentinel.** A completed migration writes `memory.sqlite.migrated` next to the database. If the database is later lost, the sentinel prevents the plugin from recreating a store out of the old JSON. Delete the sentinel file to run a migration again deliberately.

**Daily automatic backup.** The first write of each day runs `VACUUM INTO` into `<store folder>\backups\memory-<timestamp>.sqlite` — one self-contained file, with the most recent 30 kept.

**Optimistic locking.** Every write checks the `revision` key in the SQLite `meta` table and, on a mismatch, re-reads and replays the change instead of overwriting entries written by the other process.

**`remember` fixes.** `remove` is now two-step: the first call echoes the entry, the second call with `confirm=true` deletes it. `search` prints global entry numbers rather than positions in the hit list. `update` enforces the 2048-byte content limit.

**Behaviour fixes.** `status=archived` is preserved, `global` entries can be unpinned, and a `画像` tag is no longer silently removed.

### 2.11 0.4.3 fixes

0.4.3 is a correctness release; nothing to migrate or configure.

**One snapshot per read.** The entry rows and the `revision` counter are now read inside one read transaction. Before, a write from the other process landing between the two statements produced "old entries + new revision"; the optimistic lock then accepted the stale copy and silently deleted the entry that had just been added.

**`storageInfo()` does not create a database.** Asking the page for its status no longer opens (and therefore creates) a missing SQLite file, so the "database lost + migration sentinel" degraded state survives a page refresh.

**Per-conversation injection.** The latest user message is cached per session and looked up through the assembly context, so a subagent or a second window can no longer change which memories another conversation gets.

**Delete-by-number re-check.** If the numbering moved between the preview and the confirmed call, the deletion is refused with `MEMORY_CONFIRM_MISMATCH` instead of deleting a different entry. Delete by `id` to skip the check.

**Smaller fixes.** `ephemeral` entries now carry the session id of the call that created them (they used to be dormant forever); an oversized request body gets `413` instead of a reset connection.

### 2.12 0.4.4 fixes

0.4.4 is a correctness, hardening and release-engineering release. Nothing to
migrate or configure: replace the plugin files (and take the exe from Releases),
keep your store.

**The master switch gates writes.** With `enabled: false` every write route
(`entry/add`, `entry/update`, `entry/delete`, `inbox`, `inbox/bulk`) answers
`409 MEMORY_DISABLED`; `/api/settings` stays writable so you can turn memory back
on, and reads (`/api/state`, `/api/export`, `/api/preview`) still work.

**Inbox actions are distinct.** `accept` applies the submitted fields and makes
the entry active; `reject` only sets `rejected`; `edit` applies the fields but
keeps the current status. `inbox/bulk` accepts only `accept` / `reject`. Content
over 2048 bytes answers `400` before anything is written.

**Settings are checked before they are written.** `injectMode` must be
`relevant` / `all` and `showIndex` a boolean; anything else answers `400` with
the current config echoed back, and nothing is stored. `judgeMode` only accepts
`model` / `rules` / `off`, `lang` is normalised, and the numeric keys only accept
finite values `> 0`; invalid values are ignored rather than written, so settings
are never half-applied. `{reset: true}` restores every default, including
`enabled`.

**Export and overrides are transparent.** `/api/export` also carries `degraded`,
`revision`, `dataFile` and `storage`; `settings.overrides` echoes the deployment
values (the same allow-list the page writes, plus `lang`).

**HTTP errors are precise.** A known path with an unsupported method answers
`405` + `Allow`; `PATCH` / `DELETE` still answer `404`. `id` and `number` are
cross-checked: a shifted number answers `409 MEMORY_CONFIRM_MISMATCH`. Duplicate
detection is normalised (case-, whitespace- and punctuation-insensitive), and
`sameFile()` compares paths correctly per platform.

**Security.** The injected section states that it is data, not instructions;
each line is tagged `[user]` / `[auto]` / `[agent]`; entries containing
instruction-like text are moved to the index-only section
`疑似指令性文本（仅索引）：`. All automatic writes go to the inbox by default
(`inbox: true`); explicit `remember` calls still write directly. The page server
only accepts a `Host` header naming a loopback address and the configured port —
anything else gets `421 Misdirected Request`.

**UI.** Invalid numeric settings are refused in place; polling no longer
overwrites unsaved edits; export failures show a toast; a 720 px breakpoint makes
360 px windows usable; statuses (including `archived`) are fully localised;
category chips count exactly what the list shows; update/delete/inbox send both
`id` and `number` and understand the new 409 / 400 responses.

**Engine.** `autoWriteStatus()` is the single inbox decision;
`entriesForAllMode()` no longer leaks another session's ephemeral entries;
`pluginBuildId()` falls back to `unknown-<base36 timestamp>`; the page process is
replaced on upgrade; a failed migration never leaves a half-created database;
`renderInjection()` prints no empty section header.

**Verification (0.4.4).** core-audit 12 files / **220 checks green**; http-audit
**65/67** (the 2 remaining reds — A37 and B5 — are contradictions inside the
audit script itself); static-audit **25/27** (S26/S27 are false positives; run it
manually with `node tests/static-audit.mjs`). CI runs `node --check`, the export
smoke test, core-audit and http-audit.

---

## 3. Daily use

### 3.1 The `remember` tool

| action | Required | Optional | Effect |
| --- | --- | --- | --- |
| `list` | — | — | every entry with its number, category, priority, status |
| `read` | `id` or `index` | — | full text + metadata of one entry |
| `add` | `content` | `category`, `priority`, `project`, `tags`, `ttlDays` | create; refuses duplicates |
| `update` | `id` or `index` | `content`, `category`, `priority`, `status`, `project`, `tags`, `ttlDays` | rewrite in place, id preserved, `updatedAt` refreshed |
| `remove` | `id` or `index` | `confirm` | two-step: the first call echoes the entry, `confirm=true` deletes it |
| `search` | `keyword` | — | match over content, tags and project |

Numbering is insertion order and identical in `list`, in the injected section, on the page and in `search` output — so "entry 3" always means the same thing.

The agent is instructed to **search first and update rather than add**: one fact, one entry, always the latest text.

### 3.2 Choosing the right category

| You are storing… | Use | Why |
| --- | --- | --- |
| a rule that has to hold on every turn | `global` | always injected |
| how they react, what they care about, what they push back on | `persona` | always injected, and it is what makes the assistant feel like it knows them |
| a path / script / pitfall bound to one repository | `project` (+ `project` name) | only eligible while that project is active |
| scratch context that only matters today | `ephemeral` | dies with the session |
| anything else worth keeping | `general` | keyword-selected |

If you want "always injected" without thinking about categories, start the text with `[全局]` — the plugin strips the marker and treats the entry as `global`.

### 3.2b What a `persona` entry has to look like

`persona` is the category that makes the assistant feel like it knows you — and the one that turns creepy when written badly. Third-person verdicts about a person read like a file being kept on them behind their back; that reaction ("why are you keeping notes on me?") is a signal you have written a profile instead of a record.

What separates a usable `persona` entry from a creepy one is not tone, it is **evidence**. A well-formed entry has four properties:

| Property | What it means | Why it matters |
| --- | --- | --- |
| **dated** | it carries the date of the observation | an undated observation cannot expire, and persona notes age |
| **scene-bound** | it names what actually happened | a scene can be confirmed; a character trait cannot |
| **anchored** | it keeps their own words or a concrete action | paraphrasing is where invention enters |
| **one line of reading** | judgement comes last and stays short | the evidence stays intact and the interpretation is clearly separate |

A badly formed entry has the opposite profile: adjective-first, undated, scene-free, nothing the reader could confirm or deny. That profile is what makes a memory file read like a dossier — and it is the one users ask to have deleted.

Template (structure only, no content): `YYYY-MM-DD  <what happened>  — "<their words>"  — <one line of reading>`.

If you cannot recall a scene and the wording, write nothing — an empty persona section is better than an invented one.

Practical consequences:

* Persona entries age. Add the date; when the observation stops matching reality, `update` it instead of stacking a contradicting twin.
* Never store a persona entry that only restates a `global` rule in psychological language — the rule itself belongs in `global`.
* Persona entries are always injected, so they are the most expensive bytes you own. Every sentence must earn its place.

### 3.3 What gets injected, and why the numbers matter

Order: `global` + `persona` (all, subject to budget) → `project` (eligible ones that also match) → `ephemeral` (same session) → `general` (keyword-matched) → a numbered index of everything else.

* A sentence with several topics is split into *coverage units* — mentioned tags first, then punctuation-separated clauses — and each unit contributes its own entries, so one loud topic cannot monopolise the budget.
* Explicit recall ("extract every memory about X") bypasses `minScore`/`maxRelevant` and widens the budget to `recallMaxBytes`.
* Nothing that is `pending`, `rejected` or expired is ever injected.

**Read the dashboard before you complain about cost.** It shows the byte/token split of the current injection, and warns when always-on memories exceed 40–90 % of the budget — that is your cue to demote project facts or trim globals.

### 3.4 Workflows worth knowing

**Project switching.** Keep project facts as `project` entries, then set `currentProject` when you switch (page ▸ Settings, or edit the patch). Their entries are then eligible by keyword even when you don't name the project; unset it and they go dormant.

**Recording a pitfall.** Just hit the problem in chat. Under `judgeMode: model` the agent decides it is worth keeping, searches for an existing note on the same topic, and writes or updates it — usually with tags like `pitfall` / `lesson`. You do not have to say "remember".

**Fixing a wrong memory.** Page ▸ Memory Hub ▸ click the entry ▸ edit the text, change category/priority/TTL ▸ **Save**, or **Delete** (two-step confirmation: click, then type the confirmation word). Edits take effect on the agent's next turn; no restart needed.

**Inbox discipline.** Rule-extracted persona facts (only with `judgeMode: rules`) land in the inbox as `pending`. Accept the ones that are true, reject the rest; a rejected entry never reaches the prompt.

**Backups.** `GET /api/export` (page ▸ Export JSON) writes the whole store as JSON — that is the portable backup and the one that survives a runtime change. The migration also leaves `memory.json.bak_pre_sqlite_<timestamp>` next to the old JSON.

---

## 4. Troubleshooting

### 4.1 The agent has no memory at all

| Check | Command / place | Expected |
| --- | --- | --- |
| DSH restarted after install? | — | bundles load at boot only; restart is mandatory |
| Plugin mounted? | Settings → Plugins | `dsh-thirdparty-memory` present, mounted |
| Bundle registered? | profile `package.json` → `dsh.profile.bundles` | contains `dsh-thirdparty-memory` |
| Patch applied? | `dsh web --dump-config` (CLI) or profile `cordis.patch.yml` | contains the `- id: thirdparty-memory` block |
| Junction healthy? | `<profile>\node_modules\dsh-thirdparty-memory` | points at the plugin dir |
| Peer resolvable? | `<plugin>\node_modules\@deepseek-ai\dsh-tools\package.json` | exists |

Re-run `attach.ps1`; every line is either `[ok]`, `[skip]` or `[fail]` — `[fail]` tells you which link is wrong.

### 4.2 The memory page does not open

```bat
dsh-memory-manager.exe --status      :: 0 = healthy, 1 = not running, 3 = port owned by another app
dsh-memory-manager.exe --start       :: start it
```

> Reading that exit code: the manager is a GUI-subsystem executable, so PowerShell's `&` returns before it finishes and `$LASTEXITCODE` stays empty. Use `cmd /c "dsh-memory-manager.exe --status & echo %ERRORLEVEL%"` or `Start-Process -Wait -PassThru …` when you need the number.

* **exit 3** → someone else owns the port. `--port 7900`, or tray ▸ Change port…
* Start succeeds but the browser shows nothing → check `http://127.5.0.1:7891/` as well as `http://127.0.0.1:7891/`.
* The page worked and then went blank → the process died (killed by a cleanup script, a reboot, or the OOM killer). `--start` brings it back; the plugin also spawns it at DSH boot.

### 4.3 "My memories are gone!"

Almost never true. Check in this order:

1. **Different store.** Run `dsh-memory-manager.exe --data` and compare it with the `dataFile` in the plugin's patch. A `--store` switch or an old `dataFile` value explains "0 entries" instantly.
2. **Different host.** Two DSH installations (MSIX + portable) can each have their own profile. Run `attach.ps1` for both.
3. **Pending / rejected.** The dashboard counts them separately; the inbox is where unapproved facts wait.
4. **Expired.** `expiresAt` in the past hides an entry silently — filter chips ▸ ⏰ Expired.
5. **The store is actually damaged** (rare: interrupted writes are the usual cause). The live files are `memory.sqlite`, plus `-wal` / `-shm` while the page is running. Since 0.4.1 every write checkpoints the WAL back into the main file, so the main file alone is complete. Stop the page (`--stop`), move aside any leftover `-wal` / `-shm`, then put `memory.sqlite` back from a backup (or re-import an export); do not hand-edit the files while the page is running.
6. **Fallback JSON, unreadable** — check it parses: `node -e "JSON.parse(require('fs').readFileSync('memory.json','utf8'))"`. If the store is SQLite, look at `GET /api/state` — its `storage` field reports the backend and the path — instead of parsing it by hand.

### 4.4 Bad memories keep getting in

* Switch to `judgeMode: model` (the agent judges) or `off` (only explicit requests) — the regex fallback is the noisy path.
* Keep `inbox: true` so rule-extracted persona facts need approval.
* Delete the offending entries (page, two-step confirm). The extractor also refuses sentences that are negated or meta ("when the user says remember…"), and technical instructions.

### 4.5 Prompt cost too high / model gets distracted

* Dashboard ▸ the bar tells you which section is expensive; always-on (`global` + `persona`) is the usual culprit.
* Demote project facts to `project` and set `currentProject` only when needed.
* Lower `maxBytes`, `maxRelevant`, `perCluster`; raise `minScore`.
* Turn `showIndex` off for the leanest prompt (you lose discoverability).
* Persona notes are cheap and useful — trim rule-like globals first, not persona.

### 4.6 Windows-specific traps

| Trap | Symptom | Fix |
| --- | --- | --- |
| Task Scheduler auto-start | Windows Defender may treat a self-created scheduled task as a heuristic trojan (task registration fails with `0x800700E1`) | do not create one; put the exe in the Startup folder, or start it from the tray after logon |
| PowerShell 5.1 + UTF-8 scripts | `attach.ps1` fails to parse, Chinese messages turn into mojibake | scripts ship as UTF-8 **with BOM**; do not re-save them as BOM-less UTF-8 |
| A profile `package.json` carrying a BOM | DSH Desktop exits with code `1` on every start: three crashes, then it stops auto-restarting | run `attach.ps1 -Repair`; 0.4.0 installers write manifests without a BOM |
| `wscript` + non-ASCII paths | the launcher cannot find `server.js` | launchers are pure ASCII and derive paths at runtime; keep the plugin/store in ASCII paths |
| Antivirus slows or blocks the first run | extraction takes long, or `node.exe` is quarantined | allow the exe / its `%LOCALAPPDATA%` folder |
| Junction vs. copy | edits to the source don't appear | a junction reflects edits immediately; a copy does not — re-copy or switch to a junction |
| Two DSH hosts at once | page serves one store, the other host uses another | point both profiles at the same `dataFile` |

### 4.7 Uninstall

1. Delete the `- id: thirdparty-memory` block from each profile's `cordis.patch.yml` and `dsh-thirdparty-memory` from `dsh.profile.bundles`.
2. Remove `<profile>\node_modules\dsh-thirdparty-memory` (and the `dsh-tools` junction inside the plugin if you created it).
3. Restart DSH.
4. Delete the page process (`--stop`), the plugin folder, and — if you want the memories gone — the store folder (`%APPDATA%\dsh-thirdparty-memory\`, or wherever `dataFile` points) and `%LOCALAPPDATA%\dsh-thirdparty-memory`.
5. Memories live only in that local SQLite database; nothing is uploaded anywhere.

---

## Appendix A — file map

```
dsh-thirdparty-memory/
├── index.js              plugin entry (system prompt section/context, remember tool, events, page spawn)
├── core.js               pure logic: model, migration, tokenizer, selection, rendering, token estimate
├── server.js             memory page server (node:http, loopback only)
├── ui.html               memory page UI (single file, no external assets, 3 languages)
├── cordis.patch.yml      bundle patch (inserts the thirdparty-memory row)
├── package.json          package manifest (dsh.bundle.patch, peer: dsh-tools)
├── attach.ps1            multi-host installer (junction + bundles + patch + peer + dataFile)
├── build-single-exe.ps1  rebuilds the single-file manager
├── build-release.ps1     packages release\dsh-thirdparty-memory-<version>.zip (+ leak check)
├── RELEASE-0.4.4.txt     release notes for this version (English root + Chinese notes)
├── tools/md2txt.mjs      regenerates the .txt docs from the .md sources
├── tests/                audit + regression suites (CI runs core-audit and http-audit; static-audit is manual)
├── manager/
│   ├── DshMemoryManager.cs   single-file manager source (embeds Node + docs)
│   └── Program.cs            legacy "same-folder" manager source (not shipped)
├── start-memory-page.vbs / .bat, stop-memory-page.bat, 启动记忆页.bat, 停止记忆页.bat
├── docs/                 tutorial.md/.txt (en, zh-CN, zh-TW), NODE-LICENSE.txt
├── examples/             cordis.patch.yml.example
├── data/memory.json      legacy store location — read-only migration source since 0.4.0
├── README.md / README.zh-CN.md / README.zh-TW.md  (+ .txt)
└── LICENSE
```

The live store is not inside the plugin folder any more: it defaults to `%APPDATA%\dsh-thirdparty-memory\memory.sqlite`.

## Appendix B — endpoints

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| GET | `/` | — | memory page HTML (language injected server-side) |
| GET | `/api/state?q=&session=` | — | config, settings, entries, dashboard, preview |
| GET | `/api/export` | — | full JSON |
| POST | `/api/entry/add` | `{content, category?, project?, priority?, tags?, ttlDays?}` | 400 empty, 409 duplicate |
| POST | `/api/entry/update` | `{id, number?, ...fields}` | `ttlDays`, `clearExpiry`; a shifted number answers `409 MEMORY_CONFIRM_MISMATCH` |
| POST | `/api/entry/delete` | `{id, number?, confirm: true}` | one at a time by design; also re-checks the number |
| POST | `/api/inbox` | `{id, number?, action: accept\|reject\|edit, content?, …}` | accept = apply + active · reject = status only · edit = apply, status unchanged |
| POST | `/api/inbox/bulk` | `{action: accept\|reject}` | anything else answers `400` |
| POST | `/api/settings` | `{enabled?, autoExtract?, judgeMode?, injectMode?, showIndex?, lang?, maxBytes?, …}` | `{reset:true}` restores defaults |
| POST | `/api/preview` | `{q?, session?}` | renders the injection |

All POSTs require `Content-Type: application/json`. The server only answers when
the `Host` header names a loopback address (`127.0.0.1`, `127.5.0.1`,
`localhost`, `::1`, or the configured `pageHost`) and the configured port;
otherwise it returns `421 Misdirected Request`. A registered path called with an
unsupported method returns `405` + `Allow`, while `PATCH` / `DELETE` and other
unknown methods return `404`. When the master switch is off, write routes return
`409 MEMORY_DISABLED` and `/api/settings` remains writable.

## Appendix C — quick reference

```bat
:: manager
dsh-memory-manager.exe --install / --start / --stop / --restart / --status
dsh-memory-manager.exe --port 7900 --store D:\dsh-memory-data --lang zh-CN

:: attach to every detected profile, store outside the plugin
powershell -ExecutionPolicy Bypass -File attach.ps1 -DataFile "D:/dsh-memory-data/memory.json"

:: strip a UTF-8 BOM from profile manifests (DSH Desktop exits with code 1), then restart DSH
powershell -ExecutionPolicy Bypass -File attach.ps1 -Repair

:: move the default store folder
set DSH_THIRDPARTY_MEMORY_HOME=D:\dsh-memory-data

:: rebuild the single-file exe (needs .NET Framework 4.x csc.exe)
powershell -ExecutionPolicy Bypass -File build-single-exe.ps1

:: package the release zip (leak-checks personal paths, never includes real memories)
powershell -ExecutionPolicy Bypass -File build-release.ps1

:: regenerate the .txt docs from the Markdown sources
node tools/md2txt.mjs README.md docs/tutorial.md

:: run the audits (CI runs the first two; static-audit is manual)
node tests/core-audit/run-all.mjs
node tests/http-audit.mjs
node tests/static-audit.mjs
```

License: MIT. The bundled Node runtime is MIT as well — see `docs/NODE-LICENSE.txt`.
