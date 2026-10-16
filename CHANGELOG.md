# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-10-16

### Added

- `projects_root` plugin option: locations anywhere under it scope to the first path segment below
  the root, so sessions rooted deep inside a project share that project's memory.
- Test suite (`bun test`) for option resolution and scope detection; `run-tests` workflow on every
  push and pull request.
- Documentation under `docs/`: configuration, design (SDD), troubleshooting; `CONTRIBUTING.md`,
  `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue and pull request templates.

### Changed

- Licence to AGPL-3.0.
- Without `projects_root` the scope is the git root's basename, else the directory name; the
  previous fixed root is gone.
- `@opencode/plugin` pinned; lockfile tracked and installed frozen in CI.

## [0.1.0] - 2026-10-04

### Added

- `## Memory` block injected into every turn's context and into compaction: shared facts, facts
  scoped to the current project, recent session titles.
- Tools `memory_add`, `memory_list`, `memory_forget`, `memory_pin`.
- SQLite store (`bun:sqlite`) with runtime settings (`max_inject_chars`, `recent_sessions`,
  `max_rows`, `enabled`), row-cap eviction of unpinned entries and a `memory.md` mirror.
- Session titles recorded at end of turn.

[Unreleased]: https://github.com/rojosinalma/opencode-memory/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/rojosinalma/opencode-memory/releases/tag/v0.2.0
[0.1.0]: https://github.com/rojosinalma/opencode-memory/commit/8be3ba5
