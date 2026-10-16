# Configuration

Three layers: plugin options in `opencode.jsonc`, runtime settings in the database, and one
environment variable for the database path.

## Plugin options (`opencode.jsonc`)

Set options on the same `plugins[]` path the plugin is discovered from — a second path to the same
directory loads a second instance.

```jsonc
{
  "plugins": [
    { "package": "./plugins/memory", "options": { "projects_root": "~/projects" } }
  ]
}
```

| key | default | meaning |
|---|---|---|
| `projects_root` | unset | Directory holding your projects. A location anywhere under it scopes to the first path segment below the root, so a session rooted deep inside a project (for example `<project>/data/…/session-<id>/`) still shares that project's memory. `~` expands. Without it the scope is the git root's basename, else the directory name. |

## Runtime settings (database `settings` table)

These are read on every use and need no restart. Change them with any SQLite client:

```sh
sqlite3 ~/.local/share/opencode/memory.db \
  "UPDATE settings SET value = '8000' WHERE key = 'max_inject_chars'"
```

| key | default | meaning |
|---|---|---|
| `max_inject_chars` | `6000` | Hard ceiling on injected characters. Rows past the budget are dropped and the block says how many were omitted. |
| `recent_sessions` | `5` | Recent session titles surfaced per project. `0` disables the section. |
| `max_rows` | `500` | Total row cap across all projects; the oldest unpinned rows are evicted past it. `0` disables eviction. |
| `enabled` | `1` | Kill switch. Anything other than `1` injects nothing; the tools keep working. |

## Environment

| variable | default | meaning |
|---|---|---|
| `OPENCODE_MEMORY_DB` | `$XDG_DATA_HOME/opencode/memory.db` (`~/.local/share/opencode/memory.db`) | Database path. The parent directory is created on first open. A `memory.md` mirror is written next to it after every write. |

The variable must be in the environment of the OpenCode server process (the plugin runs inside it).
