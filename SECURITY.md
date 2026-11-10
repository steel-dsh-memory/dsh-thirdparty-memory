# Security policy

## Supported versions

Only the current `0.4.x` line receives fixes.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (repository → Security →
Report a vulnerability). Do **not** open a public issue with reproduction steps,
memory contents, absolute paths, tokens, or screenshots of the memory page.

If private reporting is unavailable, open a minimal issue that says
"security: please contact me" without details, and a maintainer will reach out.

## In scope

- The plugin (`core.js`, `index.js`), the local memory page (`server.js`,
  `ui.html`, bound to `127.5.0.1:7891` by default) and the manager exe.
- The SQLite store, its migration and its backup path.

## Out of scope

- The showcase website and its downloads (separate deployment).
- Third-party DSH builds, modified plugin copies, and anything running with
  elevated privileges or a non-loopback page host.

## Design commitments

- The store is local; there is no telemetry, no remote logging and no network
  call in normal operation.
- Writes go through an optimistic lock; a failed read degrades to read-only
  instead of silently falling back to an older snapshot.
- The memory page binds loopback only and refuses cross-site form submissions
  (POST requires `application/json`, oversized bodies answer 413).
- Deletion requires a second confirmation in both the CLI tool and the page API.