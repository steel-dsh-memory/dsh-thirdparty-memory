# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- The local memory page process is now replaced on upgrade: a new process probes
  `/api/health`, compares the build identity, and only then retires the old
  detached page server. Previously a page process started before an upgrade kept
  serving old code forever, because the port was taken and the new process
  exited silently.
- `pluginBuildId()` (source hash) lets hot fixes be recognised without a version
  bump.
- A failed JSON → SQLite migration no longer leaves a half-created empty
  database behind; the next read stays in the degraded (read-only) state instead
  of accepting writes into an empty store.
- The backend cache key now includes the legacy source path, so calling
  `storageInfo()` before the first `loadStore()` can no longer skip the
  one-time migration permanently.

### Changed

- `renderInjection()` no longer prints a section header with no entries under it.
- `storageInfo()` reports the number of expired entries.
- Tags are de-duplicated by `parseTags()`.

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