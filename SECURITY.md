# Security policy

## Reporting a vulnerability

Report privately through
[GitHub Security Advisories](https://github.com/rojosinalma/opencode-memory/security/advisories/new)
(the **Security** tab → *Report a vulnerability*). Do not open a public issue. You will get an
acknowledgement within a week and a fix or a statement before any public disclosure.

## Supported versions

Only the latest release receives fixes. Update your checkout to the newest `vX.Y.Z` tag before
reporting.

## What the plugin holds

The plugin runs inside the OpenCode server process and stores whatever the agent is told to
remember in a local SQLite database (`~/.local/share/opencode/memory.db` by default) plus a
`memory.md` mirror next to it. Keep in mind:

1. Memory content is injected into the system prompt of every session on the same machine — in every
   project when scoped `shared`. Never store secrets in it; store where they live instead.
2. The database and the mirror are plain files with your user's permissions. Protect them like any
   other file in your home directory.
3. The plugin makes no network requests and reads no environment variable other than
   `OPENCODE_MEMORY_DB` and `XDG_DATA_HOME`.
