# Contributing

Thanks for taking a look. This is an **unofficial third-party project**: it is
not associated with DeepSeek or Doubao, and issues and pull requests should keep
that framing.

## Ground rules

- **Never commit memory data.** `data/`, `backups/`, `*.sqlite*`, `secrets/` and
  `.env` are local user data and are ignored on purpose.
- **One concern per pull request.** Keep fixes and features separate.
- **Keep the zero-dependency promise.** `core.js`, `index.js` and `server.js`
  must run on plain Node.js with no `npm install`. SQLite storage uses the
  built-in `node:sqlite` (Node 22.5+; the bundled runtime is Node 24).
- **Windows-first, not Windows-only.** Do not assume drive letters, `netstat`
  output or Win32 APIs where a portable fallback is possible.
- **English is the root language** for documents; UI strings ship as
  `en` / `zh-CN` / `zh-TW`. A short Chinese summary in a pull request is welcome.
- **Memory contents are user data.** Any change that can lose, duplicate or
  reorder entries needs a regression test under `tests/core-audit/`.

## Local checks

```bash
node --check core.js
node --check index.js
node --check server.js
node tests/core-audit/run-all.mjs    # needs Node 22.5+ for node:sqlite
```

The suite runs on isolated temporary directories and never touches a real
store. `tests/http-audit.mjs` starts an isolated memory page on ports 7892/7893.

## Commit messages

`area: what changed` — for example `core: read revision and rows in one
transaction`. Reference an issue or release note when there is one.

## Reporting security issues

Please do **not** open a public issue. See [SECURITY.md](SECURITY.md).

## Code of conduct

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).