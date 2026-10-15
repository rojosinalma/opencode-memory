# opencode-memory

An [OpenCode](https://opencode.ai) plugin that gives the agent a durable, cross-session memory in a
local SQLite database. Every turn it injects a `## Memory` block into the system prompt: facts shared
across all projects, facts scoped to the current project, and the project's recent session titles.
The agent manages the store itself through four tools — `memory_add`, `memory_list`, `memory_forget`
and `memory_pin` — so "remember that we use X" survives the session, the compaction and the project
switch. Retrieval is deliberately "inject everything relevant" rather than vector search: at this
scale a few dozen facts cost less to inject wholesale than an embedding round-trip would, and it is
deterministic.

## Install

Clone into the global plugins directory; it is auto-discovered and works without options:

```sh
git clone https://github.com/rojosinalma/opencode-memory ~/.config/opencode/plugins/memory
```

To set options, reference **that same path** from `opencode.jsonc` (a different path to the same
plugin would load a second instance):

```jsonc
{
  "plugins": [
    { "package": "./plugins/memory", "options": { "projects_root": "~/dev" } }
  ]
}
```

No runtime dependencies: SQLite comes from Bun's built-in `bun:sqlite`, `@opencode/plugin` is imported
as types only.

## Configuration

Plugin options (`opencode.jsonc`):

| key | default | meaning |
|---|---|---|
| `projects_root` | unset | directory holding your projects; a location anywhere under it scopes to the first path segment below the root, so a session rooted deep inside a project still shares that project's memory. `~` expands |

Runtime knobs live in the database's `settings` table and need no restart:

| key | default | meaning |
|---|---|---|
| `max_inject_chars` | `6000` | hard ceiling on injected characters |
| `recent_sessions` | `5` | recent session titles surfaced per project |
| `max_rows` | `500` | total row cap; oldest unpinned rows are evicted past it |
| `enabled` | `1` | kill switch |

Environment:

| variable | default | meaning |
|---|---|---|
| `OPENCODE_MEMORY_DB` | `$XDG_DATA_HOME/opencode/memory.db` (`~/.local/share/…`) | database path; a `memory.md` mirror is written next to it |

## How it works

1. `session.hook("context")` and `session.hook("compaction")` inject the block (shared facts, then the project scope, then recent titles). Pinned entries come first and are never evicted.
2. The project key is the first path segment under `projects_root` when that is set and the location lies there, else the git root's basename, else the directory name.
3. Session titles are recorded at end of turn from `session.execution.*` events.

## Tests

```sh
bun test
```

## Caveats

- Loaded per location boot; running locations keep the plugin set they started with.
