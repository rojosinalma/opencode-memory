# Troubleshooting

## The block is missing from a running session

The plugin is loaded when a location (project directory) boots inside the OpenCode server. A
location that was already running when the plugin was cloned or its options changed keeps the plugin
set it started with. Create a new session for that project, or restart the server, to pick it up.

## `MEMORY UNAVAILABLE: …` in the prompt

The plugin could not read the database. The block is replaced with the error message on purpose, so
a broken store never looks like an empty one. The same message is logged once as
`[memory] failed to read memory: …` on the server's stderr. Usual causes: the path in
`OPENCODE_MEMORY_DB` is not writable, or the file is locked by another process beyond the 5 s busy
timeout.

## Two memory blocks, or facts saved twice

The plugin is instantiated once per `plugins[]` entry. Referencing the plugin directory from
`opencode.jsonc` under a path other than the one it was auto-discovered from loads a second copy.
Use the same path (`./plugins/memory` relative to the config directory) for the options entry.

## A fact was saved to the wrong project

The project key is derived at location boot (see `docs/SDD.md` → Key flows → Scope). Check it with
`memory_list`: each row shows its scope in parentheses. To move a fact, `memory_forget` it and
`memory_add` it again from a session in the right project, or set `projects_root` so nested
locations collapse onto their project.

## Session titles do not appear

Titles are recorded at the end of a turn (`session.execution.succeeded|failed|interrupted`) and on
`session.renamed`, only for sessions whose directory equals the instance's own location. A session
without a title yet, or one rooted in another directory, is skipped. `recent_sessions` set to `0`
hides the section entirely.

## Older entries omitted

`(N older entries omitted; call memory_list to see all.)` means the `max_inject_chars` budget ran
out. Raise it in the `settings` table, pin what must always be present (`memory_pin`; pinned rows
are rendered first), or prune with `memory_forget`.

## Where the data is

`~/.local/share/opencode/memory.db` by default (WAL mode, so `memory.db-wal` and `memory.db-shm`
appear next to it), plus `memory.md`, a read-only rendering of every row grouped by scope. Edit the
store through the tools, not the Markdown file — the mirror is overwritten after every write.
