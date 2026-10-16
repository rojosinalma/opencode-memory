# Software design document

## Purpose

opencode-memory gives an OpenCode agent facts that outlive a session: durable preferences, decisions
and environment details, stored in SQLite and injected into the system prompt on every turn. The
agent writes to the store itself through tools, so the memory grows from the conversation instead
of from a separate editing step.

## Architecture

One file, `index.ts`, exports a `Plugin.Plugin` object with `id: "memory"`. OpenCode instantiates it
once per location (project directory) it boots. Each instance:

1. derives its project key from `ctx.location` and the plugin options (`scopeOf`);
2. registers two session hooks, `context` and `compaction`, that push the rendered `## Memory` block
   onto `event.system`;
3. registers four tools through `ctx.tool.transform` — `memory_add`, `memory_list`, `memory_forget`,
   `memory_pin`;
4. subscribes to the server's event stream to record session titles;
5. returns a teardown that aborts the subscription and closes the database.

All instances share one `bun:sqlite` handle (module-level `db`), opened lazily by `open()`. The
plugin has no runtime dependencies: `@opencode/plugin` is imported as types only (the plugin
directory may have no `node_modules` of its own, and `Plugin.define` is an identity function), and
everything else comes from Bun or Node builtins.

## Data model and storage

Database: `OPENCODE_MEMORY_DB`, default `$XDG_DATA_HOME/opencode/memory.db`. WAL journal mode,
5 s busy timeout. The schema is created on open with `CREATE … IF NOT EXISTS` and is additive only.

| table | columns | notes |
|---|---|---|
| `memories` | `id`, `content`, `project` (NULL = shared), `pinned`, `created_at`, `updated_at` | Two partial unique indexes: `(project, content)` where project is set, `(content)` where it is NULL — so the same sentence is one row per scope. |
| `sessions` | `id`, `project`, `title`, `seen_at` | Upserted on every end of turn; indexed on `(project, seen_at DESC)`. |
| `settings` | `key`, `value` | Runtime knobs, seeded with the defaults on first open; see `docs/configuration.md`. |

A Markdown mirror, `memory.md` next to the database, is rewritten atomically (`.tmp` + rename) after
every successful write. It is a convenience for reading and version-controlling the store; failures
writing it are swallowed so they never break a tool call.

## Key flows

### Scope

`scopeOf(projectDirectory, directory, opts)`:

1. With `projects_root` set and the location under it, the key is the first path segment below the
   root — tried on the session directory first, then on the git project directory.
2. Otherwise the basename of the git project directory.
3. Otherwise the basename of the location directory, and `global` as the last resort.

This is pure and covered by `test/scope.test.ts`.

### Injection

`render(project, sessionID)` builds the block:

1. Returns an empty string when `enabled != 1` or there is nothing to show (the hook then pushes
   nothing).
2. Sections in order: shared facts, project facts, recent session titles — each row as
   `- [id] (pinned)? content`, pinned rows first within a section, then newest `updated_at`.
3. Rows are added whole-line against the `max_inject_chars` budget; a heading whose rows all fell
   past the budget is rolled back; the count of omitted rows is appended so truncation is visible.
4. A closing instruction tells the agent when to call `memory_add` / `memory_forget`.

If rendering throws, the hook injects `MEMORY UNAVAILABLE: <error>` instead and logs the message once
per distinct error, so a broken store is never mistaken for an empty one.

### Tools

| tool | input | behaviour |
|---|---|---|
| `memory_add` | `content`, `scope` (`shared` default, `project`) | Trims, rejects empty or > 2000 chars; upserts (a duplicate refreshes `updated_at`); runs eviction; rewrites the mirror. |
| `memory_list` | `filter?` | Shared + current-project rows, case-insensitive substring filter, with the total count across all projects. |
| `memory_forget` | `id` | Deletes one row, echoes its content. |
| `memory_pin` | `id`, `pinned` | Sets the flag and bumps `updated_at`. |

Every tool catches its own errors and returns the reason as text; failures are also logged as
`[memory] <tool> failed: …`.

### Eviction

After each add, `evict()` deletes the oldest unpinned rows (`updated_at ASC`) until the total row
count is within `max_rows`. Pinned rows are never evicted. `max_rows <= 0` disables it.

### Session titles

The event stream carries events for every location and the events do not carry a location
themselves, so each session id is looked up once via `ctx.session.get` and cached (map of ≤ 200
entries, cleared when full). On `session.renamed` the title and directory are cached directly. A
title is written only when the session's directory equals this instance's directory, so each
instance records its own sessions. Triggers: `session.execution.succeeded|failed|interrupted` and,
for servers that still emit it, `session.idle`.

## Configuration surface

- Plugin option `projects_root` (`opencode.jsonc`).
- Database settings `max_inject_chars`, `recent_sessions`, `max_rows`, `enabled` — read on every
  use, no restart.
- Environment `OPENCODE_MEMORY_DB`.

Details and defaults: `docs/configuration.md`.

## Decisions and rationale

- **Inject everything relevant, no vector search.** At the scale the store is used at today — a few
  dozen to a few hundred one-sentence facts — injecting the relevant rows wholesale costs less than an
  embedding round-trip and is deterministic: the same store always yields the same block, which also
  keeps the prompt cache stable within a session. If a scope outgrows `max_inject_chars`, the next
  step is FTS5 over the same rows, not a vector store.
- **Facts as single sentences, one row each.** Easier to pin, forget and dedupe than paragraphs; the
  tool descriptions steer the agent that way.
- **Scope at the directory level, with an optional projects root.** Git root works for plain
  checkouts; `projects_root` exists for front-ends that root sessions in a subdirectory of a
  project.
- **Shared scope by default.** A fact is more often about the person or their setup than about one
  repository; project scope is opt-in.
- **Settings in the database, not in options.** Changing a budget should not need a server restart
  or a config reload.
- **One database handle per process.** Instances are per location; N handles against the same file
  would gain nothing.
- **Visible degradation.** A read failure replaces the block with the error rather than omitting it.
- **Markdown mirror.** Gives the store a human-readable form and a diffable history without a second
  source of truth.

## Current scope and non-goals

Today the plugin stores plain-text facts and session titles and injects them by scope. It does no
semantic retrieval, no summarisation of transcripts, no per-user separation (one database per server
process) and no editing of a fact in place (forget and re-add). Each of these is a possible later
addition on top of the same tables.

## Operations

- **Logs**: every message is prefixed `[memory]` on the server's stderr — read failures, session
  lookup failures, tool failures, subscription end.
- **Health**: the `## Memory` block is present in the system prompt, and `memory_list` answers. A
  `MEMORY UNAVAILABLE` block is the failure signal.
- **Upgrade**: `git pull` in the plugin directory; the schema is additive and created on open, so no
  migration step. Running locations pick the new code up when they are next booted.
- **Backup**: copy `memory.db` (with its `-wal` file, or after a checkpoint) or keep `memory.md`
  under version control.
