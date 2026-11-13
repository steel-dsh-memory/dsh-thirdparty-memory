# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.4.7] — 2026-11-13

Security and correctness release for the two P1 “load-bearing” findings and four
severe P2 findings from the 0.4.6 audit. The scope is deliberately limited:
three lighter P2s remain, and all P3s are untouched. No storage-format change,
no configuration migration; upgrading is a drop-in replacement of the plugin
files and the memory store is not touched.

### Fixed

- **P1-1 — manager default directory on Chinese Windows.** The automatic
  default/legacy store directory no longer fails the ASCII-only name check;
  that check still applies when the user explicitly chooses a directory.
- **P1-2 — failed legacy JSON migration no longer becomes a silent empty
  library.** When migration fails, the readable old JSON entries are returned
  with `degraded` set, and no empty SQLite file is created over the old data.
- **P2-1 — cross-session ephemeral isolation.** Ephemeral entries bound to
  another session are excluded from the `relevant` index, from `dormant`/rest,
  and from explicit recall; they can no longer leak into another session’s
  prompt or preview. The current session’s ephemeral entries and legacy
  unbound entries keep their existing behaviour.
- **P2-2 — `injectMode: all` is now genuinely all.** `core.selectEntries`
  accepts an `all` option; global/persona entries go to `always`, the current
  session’s ephemeral entries stay ephemeral, and every other live entry goes
  to `matched` (bounded by `maxEntries`). Keyword thresholds, project activation
  and `showIndex` no longer suppress ordinary/project memory in `all` mode.
- **P2-3 — vector decimals are preserved.** `vectorWeight` and `vectorMinCos`
  are declared with `integer: false`, so `0.3`/`0.5` are no longer rounded to
  `0`/`1`; the values in `cordis.patch.yml` now take effect.
- **P2-4 — `attach.ps1` no longer resets user configuration.** An existing
  `thirdparty-memory` block is left byte-for-byte untouched when `dataFile`
  does not change; a changed `dataFile` replaces/inserts only that line and
  preserves `enabled`, `autoExtract`, `inbox`, `maxBytes`, `vectorMinCos` and
  comments. A default block is appended only when no block exists.

### Verification

- `P2` regression: `node tests/p2-regression.mjs` passes.
- core-audit: 11 files / **194/194** checks; `t02` skipped because the cloud
  host’s SQLite lock is a known environment false positive.
- HTTP audit: **67/67**; 0.4.4 regression: **16/16**.
- static-audit: **26/27**; the only failure is S26, a known false positive
  (the suite scans only `core.js`, while `injectMode` is consumed in `index.js`).
- Windows attach fixtures cover: `dataFile` change preserving `enabled: false`
  / `maxBytes` / `vectorMinCos`; a second attach leaving the patch hash
  unchanged; insertion of `dataFile` when the block has none.
- The real `F:\dsh-memory-data` store was not loaded, migrated or written by
  this release work; `memory.json` hash and `memory.sqlite` size/mtime were
  unchanged.

### Known remaining

- Memory page still parses only the YAML `enabled`/`autoExtract`/`inbox`
  switches; preview/dashboard can disagree with the real injection config and
  saving can overwrite `maxBytes` and similar keys (P2, lighter).
- Manager `ChangePort` saves config and stops the old service before checking
  whether the new port is occupied (P2, lighter).
- `judgeMode` (`model`/`rules`/`off`) is still not in the plugin Config and all
  modes run the same rule-based extraction (P2, lighter).
- P3 items are untouched.

## [0.4.6] — 2026-11-13

Bug-fix release for the two data-risk P2 findings from the 0.4.5 audit. Scope is
deliberately limited to those two fixes; the remaining P2s (all-mode selection,
recall isolation, vector decimal configuration) are not included in this release.
Windows is the primary supported platform; upgrading is a drop-in replacement and
the memory store is not touched.

### Fixed

- The JSON fallback now writes through a temporary file + `rename`, so a crash
  or power loss cannot leave a half-written JSON file. A truncated/corrupt JSON
  store now loads as `degraded` instead of a silent empty store that the next
  write would overwrite.
- The page-process handshake now compares `dataFile` as well as `buildId`. A
  same-build page serving a different store is replaced instead of silently
  exiting, so the page cannot keep editing the old database after a store switch.

### Verification

- Windows 10/11, Node 22.23.2: core-audit **12 files / 220 checks**, all pass;
  HTTP audit **67/67**.
- 0.4.4 regression remains **16/16**.
- Targeted probes cover the two fixes: JSON truncation/degraded and atomic
  overwrite; same-port/different-`dataFile` page handshake.
- The real memory store was not touched by any suite.

## [0.4.5] — 2026-11-12

Test-harness and documentation release. The plugin logic is unchanged from
0.4.4; upgrading is a drop-in replacement and the memory store is not touched.

### Fixed

- The HTTP audit's own three test-side defects were corrected: A37's `touched`
  count assumption now follows the pending count captured before the call, B5's
  outdated assertion now requires the safer `degraded` field (matching A2c), and
  A44c ignores Node's experimental/deprecation warnings. The red baseline is
  gone — the suite reports **67/67** — and the CI allow-list for A37/B5 was
  deleted.
- `tests/core-audit/run-all.mjs` and `tests/http-audit.mjs` now set
  `process.exitCode` when a check fails, so a manual run no longer looks green
  on a red suite.

### Changed

- README (three languages) verification numbers and the upgrade note were
  corrected: core 220/220, HTTP 67/67, static 25/27, regression 16/16; the old
  0.4.3-era "39 + 30 checks" line is now explicitly labelled as the old count.
  The upgrade section states that since 0.4.4 the default inbox covers every
  automatic write — auto-recorded notes wait for approval, `inbox: false`
  restores the old behaviour, and explicit `remember` calls still write
  directly.
- The CI HTTP gate is tightened from "failures ⊆ {A37,B5}" to "67/67"; the
  allow-list is gone, so a new red check fails the pipeline. `RELEASE-0.4.5.txt`
  documents this batch, and the tutorials gained §2.13.
- `tests/core-audit/t02-concurrency.mjs` is skipped explicitly in CI:
  `tests/core-audit/run-all.mjs` now supports `CORE_AUDIT_SKIP`
  (comma-separated `tXX`) and prints `[SKIP]` for skipped files. The 2-core CI
  runner can still return `SQLITE_ERROR: database is locked` in scenario B even
  with two writers — a runner SQLite lock, not the plugin losing writes. The CI
  gate validates **11 files / 194 checks / 0 failed**, while a local run keeps
  the full **12 files / 220 checks** green. (`CORE_AUDIT_WORKERS` stays as a
  general knob; CI uses 2.)

## [0.4.4] — 2026-11-12

Correctness, hardening and release-engineering release on top of 0.4.3. No
storage-format change, no configuration change, no migration: replacing the
plugin files is enough, and the SQLite / JSON stores are read as before.

### Server semantics

- **The master switch is a real gate.** With `enabled: false`, every write route
  (`entry/add`, `entry/update`, `entry/delete`, `inbox`, `inbox/bulk`) answers
  `409 MEMORY_DISABLED` instead of writing. `/api/settings` stays writable so the
  switch can be turned back on, and `GET /api/state`, `/api/export` and
  `/api/preview` keep working. The existing degraded-store `409` still takes
  precedence.
- **`inbox/bulk` validates `action`.** Only `accept` and `reject` are accepted;
  anything else answers `400` instead of silently doing nothing.
- **`accept`, `reject` and `edit` are three distinct operations.** `accept`
  applies the submitted `content` / `category` / `priority` / `project` / `tags`
  / `ttlDays` and sets `status: active`; `reject` only sets `status: rejected`
  and leaves the other fields alone; `edit` applies the same field overrides but
  keeps the current status (a pending entry stays pending). Unknown actions
  answer `400`.
- **Content length is validated before anything is written.** An inbox
  accept/edit whose content exceeds 2048 bytes answers `400` and no entry is
  touched (same wording as `add` / `update`).
- **Settings are checked before they are written.** `injectMode` must be
  `relevant` / `all` and `showIndex` a boolean; anything else answers `400`
  (with the current configuration echoed back) before any mutation.
  `judgeMode` only accepts `model` / `rules` / `off`, `lang` goes through
  `normalizeLang`, and the numeric keys (`maxRelevant`, `minScore`, `maxBytes`,
  `maxEntries`, `indexChars`, `perCluster`, `recallMaxBytes`, `maxRecall`) only
  accept finite values `> 0` and are stored as integers. Values that fail those
  rules are ignored rather than written, so settings can never be left
  half-applied.
- **`{reset: true}` restores every default**, including `enabled`, `judgeMode`,
  `lang`, `perCluster`, `recallMaxBytes` and `maxRecall`.
- **`/api/export` is self-describing.** The top level now also carries
  `degraded` (`null` when healthy), `revision`, `dataFile` and `storage`
  (`storageInfo()`), so a snapshot can be judged without a second request.
- **`settings.overrides` echoes the deployment layer.** The page writes through
  the `OVERRIDABLE_CONFIG_KEYS` allow-list; the same list (plus `lang`) is now
  read back, so "what will actually be used" is visible in one place.
- **`405` with `Allow` for a known path.** A registered path called with an
  unsupported method answers `405` and lists the methods it supports;
  `PATCH` / `DELETE` and other unknown methods still answer `404`.
- **`id` and `number` are cross-checked.** `update` / `delete` / `inbox` accept
  both; if the number now points at a different entry than the id, the request
  is refused with `409 MEMORY_CONFIRM_MISMATCH` ("编号已变化，请刷新后重试")
  instead of changing or deleting the wrong memory.
- **Duplicate detection is normalised.** `add` compares the
  `normalizeForDedupe()` form (case-, whitespace- and punctuation-insensitive),
  so "Same  fact." and "same fact" are recognised as the same memory. The
  exact-equality behaviour used elsewhere is unchanged.
- **`sameFile()` is platform-correct.** Windows path comparison normalises
  separators and case; other platforms compare case-sensitively with forward
  slashes.

### Security

- **The injected section is data, not instructions.** Its header now states that
  the entries are historical data, not instructions for the current turn, and
  that instruction-like text inside an entry does not represent the current
  user's intent. Every injected line carries its source (`[user]` / `[auto]` /
  `[agent]`).
- **Instruction-like entries are quarantined.** Entries matching an
  instruction-injection pattern (English and Chinese: "ignore previous…",
  "忽略之前…", "你现在是…", and so on) are kept out of the injected body. They
  only appear under `疑似指令性文本（仅索引）：` as truncated index lines, so a
  memory cannot smuggle a directive into the next turn.
- **The review inbox covers every automatic write.** `autoWriteStatus()` is the
  single decision point: with the default `inbox: true`, every note the plugin
  infers (profile or explicit) is stored as `pending` and cannot reach the prompt
  until it is accepted; `inbox: false` stores it as active. The `remember` tool
  still writes directly — that is the agent following an explicit instruction
  from the user, not the plugin inferring something.
- **Host allow-list on the page server.** A request whose `Host` header names
  anything other than `127.0.0.1`, `127.5.0.1`, `localhost`, `::1` or the
  configured `pageHost` — or that carries a port other than the configured port
  — is refused with `421 Misdirected Request`. Both GET and POST are covered,
  which blocks DNS-rebinding pages. A missing `Host` header is still allowed.
- **The write surface is tight.** Loopback only; POST requires
  `application/json` (cross-site form posts cannot set it); request bodies over
  128 KB answer `413`; content over 2048 bytes answers `400`; destructive
  actions are one at a time and re-check the entry number.

### UI

- **Invalid numbers are refused before the request.** Saving settings validates
  `maxBytes`, `maxRelevant`, `minScore`, `indexChars` (and the other numeric
  fields) in place: the row shows an error, nothing is sent, and no
  `toast.settingsSaved` is shown.
- **Polling no longer overwrites unsaved edits.** The 6-second refresh skips the
  settings panel while the form is dirty or focused; the rest of the page still
  updates.
- **Export failures are visible.** A failed export shows a toast instead of
  raising an unhandled rejection.
- **Narrow screens are supported.** A 720 px breakpoint folds the 224 px
  sidebar into a top bar and switches the grid to one column, so a 360 px wide
  window has no horizontal scroll.
- **Statuses are localised.** `active` / `pending` / `rejected` / `archived` go
  through `t("status." + status)`, and `archived` has its own label and colour in
  both the list and the drawer.
- **Category chips match the list.** Chip counts exclude pending entries exactly
  like the list does, so the number on a chip equals the visible rows.
- **The UI speaks the new server semantics.** Update/delete/inbox requests send
  both `id` and `number`; `409 MEMORY_CONFIRM_MISMATCH` shows "编号已变化，已刷新"
  and reloads; `409 MEMORY_DISABLED` shows "记忆已关闭"; `400` shows the server's
  message and `404` keeps its old wording. Inbox accept sends the full field set
  and edit is sent as `edit`, never as `accept`.

### Engine and rendering

- **Every auto write lands in the inbox by default** through
  `autoWriteStatus(candidate, config)`: `inbox: false` → `active`, otherwise
  `pending` (profile and explicit captures alike). The inbox configuration
  semantics are unchanged (default `true`).
- **`injectMode: all` no longer leaks sessions.** `entriesForAllMode()` drops
  ephemeral entries that belong to other sessions and keeps the current
  session's ephemeral entries as ephemeral; a second window or a subagent can no
  longer see another conversation's scratch notes.
- **`pluginBuildId()` fails soft.** When the source hash cannot be computed it
  caches `unknown-<timestamp base36>` (different per process) instead of throwing
  or returning an empty id, so hot-fix recognition and the page handshake keep
  working.
- **The page process is replaced on upgrade.** The new process probes
  `/api/health`, compares the build identity and only then retires the old
  detached page server. A page started before an upgrade used to keep serving
  old code forever because the port was taken and the new process exited
  silently.
- **A failed JSON → SQLite migration leaves no half-created database.** The next
  read stays in the degraded (read-only) state instead of accepting writes into
  an empty store.
- **The backend cache key includes the legacy source path**, so calling
  `storageInfo()` before the first `loadStore()` can no longer skip the one-time
  migration permanently.
- **`renderInjection()` no longer prints an empty section header**, and the
  budget / omission logic is unchanged.
- **`storageInfo()` reports the number of expired entries**; `parseTags()`
  de-duplicates tags.

### Release engineering

- **`attach.ps1` ships in the repository again** from the canonical copy, with
  no machine-specific paths. README "route B" now lists exactly the flags the
  script supports (`-CreateWeb`, `-Repair`, `-ProfileDir`, `-DataFile`,
  `-RuntimeDir`, `-Force`).
- **The manager exe is distributed through GitHub Releases**, not committed to
  the repository. The README says where to download `dsh-memory-manager.exe`,
  that it is an **unsigned** single file, and how to rebuild it from source
  (`build-single-exe.ps1`). The stale `dsh-memory-manager.exe` entry was removed
  from the npm `files` list (the artifact is git-ignored and build-produced).
- **The manager source matches the binary.** `manager/DshMemoryManager.cs` is now
  the 0.4.3-era source (default store under `%APPDATA%`, legacy-folder
  detection, remembering the last store) with `Version = "0.4.4"`; the stale
  0.4.0 copy is gone.
- **CI runs the real suites.** `.github/workflows/syntax.yml` keeps
  `node --check` and the export smoke test and adds
  `tests/core-audit/run-all.mjs` and `tests/http-audit.mjs` with gates.
  `tests/static-audit.mjs` stays manual on purpose — see
  [Known test-side issues](#known-test-side-issues).
- **One address everywhere.** The default is `127.5.0.1:7891` and the server
  also binds `127.0.0.1`, so both `http://127.5.0.1:7891/` and
  `http://localhost:7891/` work; the English / 简体中文 / 繁體中文 READMEs and
  tutorials say exactly that.
- `package.json` version is `0.4.4` and the `files` list matches the actual
  repository (README `.txt` copies, `attach.ps1`, `tools/`, `RELEASE-0.4.4.txt`).

### Verification

Measured on Windows 10/11 with Node 24.21.0 (`node:sqlite` available), isolated
store and port; the real store is not touched:

| Suite | Result | Notes |
| --- | --- | --- |
| `tests/core-audit/run-all.mjs` | **220/220 checks green** (12 files) | CRUD, numbering, TTL, migration, backup retention, degraded states, concurrency, WAL |
| `tests/http-audit.mjs` | **65/67** | the 2 remaining reds are contradictions inside the audit script itself: A37 and B5 |
| `tests/static-audit.mjs` | **25/27** | S26/S27 are known false positives; run manually, not in CI |
| `tests/regression-0.4.4.mjs` | green | acceptance cases written for this batch |

### Known test-side issues

- **A37** expects `inbox/bulk accept` to report `touched = 3` while it also
  relies on pending entries left by A19/A36; the two expectations are mutually
  exclusive, so the check cannot pass together with its own setup.
- **B5** requires `export.degraded === undefined`, while A2c requires the export
  to include `degraded`. Both cannot pass at once; the product keeps the safer
  `degraded` field so a degraded export cannot be mistaken for a complete one.
- **S26/S27** (static audit) only scan `core.js` and therefore report that
  `injectMode` and `maxEntries` are never consumed — they are consumed in
  `index.js`. The static suite stays out of CI and is documented as manual.

## [0.4.3] — 2026-11-10

### Fixed

- Optimistic locking could be bypassed: entries and the revision counter were
  read in two statements, so a concurrent writer could produce "old rows + new
  revision". Reproduced with four writers and silent lost updates; reads now run
  in one transaction.
- `storageInfo()` no longer opens (and therefore creates) a missing database,
  which used to disable the degraded-state protection after one page refresh.
- Prompt injection now follows the assembly's own session instead of one
  process-wide "latest message".
- Deleting by number re-checks the entry id captured at preview time and refuses
  a shifted target.
- `ephemeral` entries are bound to the calling session, so the category can be
  injected.
- Oversized request bodies answer 413 instead of resetting the connection.

## [0.4.2] — 2026-11-10

### Fixed

- The memory page delete endpoint requires `confirm: true`, matching the tool.
- `storageInfo()` reported revision/backup/vector counters as zero before any
  handle was opened; the first status view now reads real values.
- Full response/endpoint regression pass and a 5,000-entry performance check.

### Removed

- The undocumented "wipe everything" endpoint was withdrawn; there is no bulk
  clear.

## [0.4.1] — 2026-11-10

### Fixed

- `PRAGMA wal_checkpoint(TRUNCATE)` after every write, so `memory.sqlite` alone
  is a complete backup (it used to be a 4 KB shell with all data in `-wal`).
- A failed read now degrades to read-only instead of silently falling back to
  the pre-migration JSON snapshot.
- One-time migration writes a `memory.sqlite.migrated` sentinel; a missing
  database is never resurrected from an old JSON file.
- `meta.revision` optimistic lock plus retry (`mutateStore`) for concurrent
  writers.
- Daily `VACUUM INTO` backups, 30 kept.
- `remember` search prints global numbering; `update` enforces the 2048-byte
  limit; `remove` requires `confirm=true`.

## [0.4.0] — 2026-11-09

### Added

- SQLite storage through the built-in `node:sqlite` (WAL), copy-only migration
  from the old JSON store.
- Local 256-dimension hashed n-gram vector index with cosine scoring.
- Data directory moved out of the plugin folder to `%APPDATA%` (overridable with
  `DSH_THIRDPARTY_MEMORY_HOME`).
- Memory page and single-file Windows manager.

### Fixed

- The BOM in profile manifests crashed DSH at boot; JSON written by the project
  is now UTF-8 without BOM.

