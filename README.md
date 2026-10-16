# opencode-memory

[![run-tests](https://github.com/rojosinalma/opencode-memory/actions/workflows/run-tests.yml/badge.svg)](https://github.com/rojosinalma/opencode-memory/actions/workflows/run-tests.yml)
[![release](https://img.shields.io/github/v/release/rojosinalma/opencode-memory)](https://github.com/rojosinalma/opencode-memory/releases)
[![license](https://img.shields.io/github/license/rojosinalma/opencode-memory)](LICENSE)

An [OpenCode](https://opencode.ai) plugin that gives the agent a durable, cross-session memory in a
local SQLite database. Every turn it injects a `## Memory` block into the system prompt: facts shared
across all projects, facts scoped to the current project, and the project's recent session titles.
The agent manages the store itself through four tools — `memory_add`, `memory_list`, `memory_forget`
and `memory_pin` — so "remember that we use X" survives the session, the compaction and the project
switch. Retrieval is deterministic: every relevant fact is injected, within a character budget, with
no embedding step. Configuration, design and troubleshooting are documented in `docs/`.

## Requirements

- [OpenCode](https://opencode.ai) ≥ 2.0, running on [Bun](https://bun.sh) ≥ 1.4 (the plugin uses
  Bun's built-in `bun:sqlite`; no runtime dependencies).

## Installation

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

## Usage

Start a new session and tell the agent to remember something ("remember that this project deploys
with `make release`"). It calls `memory_add`, and from the next turn on every session shows a
`## Memory` block in its context with that fact — shared across projects by default, or scoped to
the current project when it says so. `memory_list` shows what is stored, `memory_forget` removes an
entry, `memory_pin` keeps one at the top and safe from eviction. The injected block is capped by the
`max_inject_chars` setting (default 6000 characters); the database lives at
`~/.local/share/opencode/memory.db` with a readable `memory.md` mirror next to it.

## Development

```sh
bun install
bun test
```

Run it against a live OpenCode by cloning or symlinking your checkout into the plugins directory and
opening a new session. Details, style and the release flow: [CONTRIBUTING.md](CONTRIBUTING.md);
architecture: [docs/SDD.md](docs/SDD.md).

## License

Copyright (C) 2026 rojosinalma. Licensed under the GNU Affero General Public License v3.0 — see
[LICENSE](LICENSE).
