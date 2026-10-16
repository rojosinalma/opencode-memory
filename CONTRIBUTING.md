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
logical change per commit, **GPG-signed** (`git config commit.gpgsign true`). Open a pull request
against `main`; the `run-tests` check must pass.

## Documentation

- `README.md` — what it is, requirements, installation, usage, development, license. Nothing else.
- `docs/configuration.md` — plugin options, runtime settings, environment.
- `docs/SDD.md` — architecture, data model, flows, decisions, scope, operations.
- `docs/troubleshooting.md` — symptoms and fixes.
- `CHANGELOG.md` — Keep a Changelog; every user-visible change gets a line under *Unreleased*.
- `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.github/` — reporting path, conduct, issue and PR templates.

A change in behaviour updates the matching file in the same commit.

## Releasing

Bump `version` in `package.json`, move the *Unreleased* section of `CHANGELOG.md` under the new
version, commit, then create a signed tag and a GitHub release whose notes are that section:

```sh
git tag -s vX.Y.Z -m vX.Y.Z && git push --tags
gh release create vX.Y.Z --title "opencode-memory X.Y.Z" --notes-file <section>
```
