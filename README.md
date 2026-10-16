# opencode-memory

An [OpenCode](https://opencode.ai) plugin that gives the agent a durable, cross-session memory in a
local SQLite database. Every turn it injects a `## Memory` block into the system prompt: facts shared
across all projects, facts scoped to the current project, and the project's recent session titles.
The agent manages the store itself through four tools — `memory_add`, `memory_list`, `memory_forget`
and `memory_pin` — so "remember that we use X" survives the session, the compaction and the project
switch. Retrieval is deterministic: every relevant fact is injected, within a character budget, with
no embedding step. Configuration, design and troubleshooting are documented in `docs/`.

## Requirements

- OpenCode 2.x running on Bun (the plugin uses Bun's built-in `bun:sqlite`; no runtime dependencies).

## Setup

Clone into the global plugins directory; it is auto-discovered and works without options:

```sh
git clone https://github.com/rojosinalma/opencode-memory ~/.config/opencode/plugins/memory
```

To set options, reference **that same path** from `opencode.jsonc` (a different path to the same
plugin would load a second instance):

```jsonc
{
  "plugins": [
    { "package": "./plugins/memory", "options": { "projects_root": "~/projects" } }
  ]
}
```

Options and runtime settings: [docs/configuration.md](docs/configuration.md).

## License

MIT — see [LICENSE](LICENSE).
