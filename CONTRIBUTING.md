# Contributing

## Running it locally

The plugin runs inside an OpenCode 2.x server on Bun. Clone the repo into the server's plugins
directory (or symlink your checkout there) and start a new session in any project:

```sh
git clone https://github.com/rojosinalma/opencode-memory ~/.config/opencode/plugins/memory
```

A location that is already running keeps the plugin set it booted with, so after an edit create a
new session (or restart the server) and check that the `## Memory` block appears in the system prompt
and that `memory_list` answers. Point `OPENCODE_MEMORY_DB` at a scratch file in the server's
environment to keep experiments out of your real store. Runtime messages are prefixed `[memory]` on
the server's stderr.

## Tests

```sh
bun install
bun test
```

`test/scope.test.ts` covers the pure functions (`resolveOptions`, `scopeOf`). New pure logic gets a
test next to it; behaviour that needs a server (hooks, tools, event handling) is verified against a
running OpenCode as described above. `.github/workflows/run-tests.yml` runs the suite on every push
and pull request.

## Code style and layout

- `index.ts` is the whole plugin: schema and settings, scope resolution, rendering, tools, the event
  subscription. Keep it that way until a second file earns its place.
- TypeScript, two-space indent, no semicolons, double quotes. No runtime dependencies:
  `@opencode/plugin` stays a type-only import, SQLite is `bun:sqlite`.
- Schema changes are additive (`CREATE … IF NOT EXISTS`, new columns with defaults) so an upgrade is a
  `git pull`.
- Every tool returns its failure as text and logs it; nothing thrown from the plugin should reach the
  server.

## Commits and PRs

Plain, descriptive commit messages in the imperative ("Add FTS fallback for large scopes"). One
logical change per commit. Open a pull request against `main`; `bun test` must pass.

## Documentation

- `README.md` — what it is, requirements, setup, license. Nothing else.
- `docs/configuration.md` — plugin options, runtime settings, environment.
- `docs/SDD.md` — architecture, data model, flows, decisions, scope, operations.
- `docs/troubleshooting.md` — symptoms and fixes.

A change in behaviour updates the matching file in the same commit.
