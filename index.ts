// Cross-session, cross-project memory backed by SQLite.
//
// Retrieval is "inject everything relevant", not vector search: at this scale a
// few dozen facts cost less to inject wholesale than an embedding round-trip
// would, and it is deterministic. If a scope ever outgrows `max_inject_chars`,
// add FTS5 over the same rows rather than reaching for a vector store.
//
// Type-only import: Bun resolves bare specifiers from the symlink's real path, where no node_modules exists.
// Plugin.define is an identity function, so the plain object is the same definition.
// Everything else is a Bun/Node builtin for the same reason.
import type { Plugin } from "@opencode/plugin"
import { Database } from "bun:sqlite"
import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path"

type Row = {
  id: number
  content: string
  project: string | null
  pinned: number
  created_at: number
  updated_at: number
}

const SETTING_DEFAULTS: Record<string, string> = {
  // Hard ceiling on injected characters. The block is stable within a session,
  // so it is prompt-cache friendly, but it is re-sent every turn.
  max_inject_chars: "6000",
  // How many recent session titles to surface per project.
  recent_sessions: "5",
  // Total row cap. Oldest unpinned rows are evicted past this.
  max_rows: "500",
  // Kill switch that needs no restart.
  enabled: "1",
}

function dbPath() {
  if (process.env["OPENCODE_MEMORY_DB"]) return process.env["OPENCODE_MEMORY_DB"] as string
  const data = process.env["XDG_DATA_HOME"] || join(homedir(), ".local", "share")
  return join(data, "opencode", "memory.db")
}

// One handle per process. The plugin is instantiated once per location, so a
// per-instance connection would open N handles against the same file.
let db: Database | undefined

function open() {
  if (db) return db
  const path = dbPath()
  mkdirSync(dirname(path), { recursive: true })
  const next = new Database(path, { create: true })
  next.run("PRAGMA journal_mode = WAL")
  next.run("PRAGMA busy_timeout = 5000")
  next.run(`
    CREATE TABLE IF NOT EXISTS memories (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      content    TEXT NOT NULL,
      project    TEXT,
      pinned     INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
  // NULL is distinct from NULL in SQL, so a partial index handles shared rows.
  next.run(`CREATE UNIQUE INDEX IF NOT EXISTS memories_project_content
              ON memories(project, content) WHERE project IS NOT NULL`)
  next.run(`CREATE UNIQUE INDEX IF NOT EXISTS memories_shared_content
              ON memories(content) WHERE project IS NULL`)
  next.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id       TEXT PRIMARY KEY,
      project  TEXT NOT NULL,
      title    TEXT NOT NULL,
      seen_at  INTEGER NOT NULL
    )`)
  next.run(`CREATE INDEX IF NOT EXISTS sessions_project_seen ON sessions(project, seen_at DESC)`)
  next.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`)
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    next.run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [key, value])
  }
  db = next
  return next
}

function setting(key: string): string {
  const row = open().query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null
  return row?.value ?? SETTING_DEFAULTS[key] ?? ""
}

function settingInt(key: string): number {
  const parsed = Number.parseInt(setting(key), 10)
  return Number.isFinite(parsed) ? parsed : Number.parseInt(SETTING_DEFAULTS[key] ?? "0", 10)
}

// First path segment below `root` when `dir` lies under it, else undefined.
function projectUnder(root: string, dir: string): string | undefined {
  if (!dir) return undefined
  const rel = relative(root, dir)
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined
  return rel.split(sep)[0] || undefined
}

export type Options = { projectsRoot?: string }

function expandHome(p: string): string {
  if (p === "~") return homedir()
  if (p.startsWith("~/")) return join(homedir(), p.slice(2))
  return p
}

export function resolveOptions(raw: Readonly<Record<string, any>> = {}): Options {
  const root = typeof raw.projects_root === "string" && raw.projects_root.length > 0 ? expandHome(raw.projects_root) : undefined
  return { projectsRoot: root }
}

// Project key for a location. With `projects_root` set, a directory anywhere under it maps to the
// first path segment below the root (so a session rooted deep inside a project — e.g. a web UI
// that roots sessions at <project>/data/…/session-<id>/ — still scopes to the project). Otherwise
// the git root's basename; where there is no repo it falls back to the directory name.
export function scopeOf(projectDirectory: string, directory: string, opts: Options = {}): string {
  if (opts.projectsRoot) {
    const nested = projectUnder(opts.projectsRoot, directory) ?? projectUnder(opts.projectsRoot, projectDirectory)
    if (nested) return nested
  }
  const fromProject = basename(projectDirectory || "")
  if (fromProject && fromProject !== "/") return fromProject
  return basename(directory || "") || "global"
}

function now() {
  return Date.now()
}

function evict() {
  const max = settingInt("max_rows")
  if (max <= 0) return
  open().run(
    `DELETE FROM memories WHERE pinned = 0 AND id IN (
       SELECT id FROM memories WHERE pinned = 0
       ORDER BY updated_at ASC
       LIMIT MAX(0, (SELECT COUNT(*) FROM memories) - ?))`,
    [max],
  )
}

function facts(project: string) {
  const shared = open()
    .query("SELECT * FROM memories WHERE project IS NULL ORDER BY pinned DESC, updated_at DESC")
    .all() as Row[]
  const scoped = open()
    .query("SELECT * FROM memories WHERE project = ? ORDER BY pinned DESC, updated_at DESC")
    .all(project) as Row[]
  return { shared, scoped }
}

function recentSessions(project: string, excludeID?: string) {
  const limit = settingInt("recent_sessions")
  if (limit <= 0) return []
  return open()
    .query(
      `SELECT title, seen_at FROM sessions
        WHERE project = ? AND id != ? AND title != ''
        ORDER BY seen_at DESC LIMIT ?`,
    )
    .all(project, excludeID ?? "", limit) as { title: string; seen_at: number }[]
}

function day(ts: number) {
  return new Date(ts).toISOString().slice(0, 10)
}

// Builds the injected block. Sections are emitted whole-line at a time against a
// shared character budget so that truncation is reported rather than silent.
function render(project: string, sessionID?: string): string {
  if (setting("enabled") !== "1") return ""
  const { shared, scoped } = facts(project)
  const recent = recentSessions(project, sessionID)
  if (!shared.length && !scoped.length && !recent.length) return ""

  const budget = settingInt("max_inject_chars")
  const lines: string[] = ["## Memory", ""]
  let used = lines.join("\n").length
  let omitted = 0

  const push = (line: string) => {
    if (used + line.length + 1 > budget) {
      omitted++
      return false
    }
    lines.push(line)
    used += line.length + 1
    return true
  }

  const section = (heading: string, items: string[]) => {
    if (!items.length) return
    const before = lines.length
    lines.push(heading)
    used += heading.length + 1
    for (const item of items) push(item)
    // Roll the heading back if the budget left no room for any of its rows.
    if (lines.length === before + 1) {
      lines.pop()
      used -= heading.length + 1
    } else {
      lines.push("")
      used += 1
    }
  }

  const fact = (row: Row) => `- [${row.id}]${row.pinned ? " (pinned)" : ""} ${row.content}`

  section("Shared facts, apply to every project:", shared.map(fact))
  section(`Facts specific to \`${project}\`:`, scoped.map(fact))
  section(
    `Recent sessions in \`${project}\`:`,
    recent.map((row) => `- ${day(row.seen_at)} ${row.title}`),
  )

  if (omitted > 0) lines.push(`(${omitted} older entries omitted; call memory_list to see all.)`)
  lines.push(
    "Call memory_add when the user says to remember/save something, or states a durable" +
      " preference or fact about their setup. memory_forget removes an entry by id.",
  )
  return lines.join("\n")
}

// A plain-text mirror of the DB, so the memory has a readable git history via
// sync.sh. Written atomically; failures are non-fatal.
function exportMarkdown() {
  try {
    const rows = open()
      .query("SELECT * FROM memories ORDER BY project IS NULL DESC, project, pinned DESC, id")
      .all() as Row[]
    const out: string[] = ["# Memory", "", `<!-- generated from ${dbPath()}; edit via the memory_* tools -->`, ""]
    let current: string | null | undefined
    for (const row of rows) {
      const key = row.project
      if (key !== current) {
        current = key
        out.push("", `## ${key ?? "shared"}`, "")
      }
      out.push(`- [${row.id}]${row.pinned ? " (pinned)" : ""} ${row.content}`)
    }
    out.push("")
    const target = join(dirname(dbPath()), "memory.md")
    const tmp = `${target}.tmp`
    writeFileSync(tmp, out.join("\n"))
    renameSync(tmp, target)
  } catch {
    // Export is a convenience; never let it break a tool call.
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function int(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number.parseInt(value.trim(), 10)
  return undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type AddInput = { content?: string; scope?: "shared" | "project" }
type ListInput = { filter?: string }
type ForgetInput = { id?: number }
type PinInput = { id?: number; pinned?: boolean }

const plugin: Plugin.Plugin = {
  id: "memory",
  async setup(ctx) {
    const directory = ctx.location.directory
    const project = scopeOf(ctx.location.project.directory, directory, resolveOptions(ctx.options))
    const log = (message: string) => console.error(`[memory] ${message}`)

    // Surfaces a failure in-prompt so a broken memory layer is visible rather than
    // looking like an empty memory.
    let degraded: string | undefined

    const block = (sessionID?: string) => {
      try {
        const text = render(project, sessionID)
        degraded = undefined
        return text
      } catch (error) {
        const message = errorMessage(error)
        if (degraded !== message) {
          degraded = message
          log(`failed to read memory: ${message}`)
        }
        return `## Memory\n\nMEMORY UNAVAILABLE: ${message}\nTell the user; do not assume there are no stored facts.`
      }
    }

    const remember = (sessionID: string, title: string, dir: string) => {
      try {
        if (dir !== directory) return // another instance owns this session
        open().run(
          `INSERT INTO sessions (id, project, title, seen_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET title = excluded.title, seen_at = excluded.seen_at`,
          [sessionID, project, title, now()],
        )
      } catch (error) {
        log(`failed to record session: ${errorMessage(error)}`)
      }
    }

    await ctx.session.hook("context", (event) => {
      const text = block(event.sessionID)
      if (text) event.system.push({ type: "text", text })
    })

    await ctx.session.hook("compaction", (event) => {
      const text = block(event.sessionID)
      if (text) event.system.push({ type: "text", text })
    })

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "memory_add",
        description:
          "Save a durable fact to memory so it is available in all future sessions. Use when the user" +
          " says to remember something, or states a lasting preference, decision, or fact about their" +
          " environment. Keep each entry one self-contained sentence; add several rather than one long one.",
        input: {
          type: "object",
          properties: {
            content: { type: "string", description: "The fact, as one self-contained sentence." },
            scope: {
              type: "string",
              enum: ["shared", "project"],
              description:
                "'shared' (default, use unless sure) makes it visible in every project." +
                " 'project' limits it to the current project.",
            },
          },
          required: ["content"],
          additionalProperties: false,
        },
        async execute(input) {
          const args = input as AddInput
          const content = str(args.content)
          if (!content) return { content: "Nothing saved: content was empty." }
          if (content.length > 2000) return { content: "Nothing saved: content too long, keep it under 2000 characters." }
          const scope = args.scope === "project" ? project : null
          try {
            open().run(
              `INSERT INTO memories (content, project, pinned, created_at, updated_at)
                 VALUES (?, ?, 0, ?, ?)
               ON CONFLICT DO UPDATE SET updated_at = excluded.updated_at`,
              [content, scope, now(), now()],
            )
            const row = (
              scope === null
                ? open().query("SELECT id FROM memories WHERE project IS NULL AND content = ?").get(content)
                : open().query("SELECT id FROM memories WHERE project = ? AND content = ?").get(scope, content)
            ) as { id: number } | null
            evict()
            exportMarkdown()
            return { content: `Saved as [${row?.id}] in ${scope === null ? "shared" : `project \`${project}\``} memory.` }
          } catch (error) {
            const message = errorMessage(error)
            log(`memory_add failed: ${message}`)
            return { content: `Failed to save: ${message}` }
          }
        },
      })

      editor.add({
        name: "memory_list",
        description:
          "List stored memories with their ids. Use before forgetting or editing an entry, or when the" +
          " user asks what is remembered.",
        input: {
          type: "object",
          properties: {
            filter: { type: "string", description: "Case-insensitive substring to match. Omit for everything." },
          },
          additionalProperties: false,
        },
        async execute(input) {
          const filter = str((input as ListInput).filter)
          try {
            const like = `%${filter}%`
            const rows = open()
              .query(
                `SELECT * FROM memories
                   WHERE (project IS NULL OR project = ?) AND (? = '' OR content LIKE ? COLLATE NOCASE)
                   ORDER BY project IS NULL DESC, pinned DESC, updated_at DESC`,
              )
              .all(project, filter, like) as Row[]
            if (!rows.length) return { content: filter ? `No memories match "${filter}".` : "No memories stored yet." }
            const lines = rows.map(
              (row) =>
                `[${row.id}] ${row.project === null ? "(shared)" : `(${row.project})`}` +
                `${row.pinned ? " (pinned)" : ""} ${row.content}`,
            )
            const total = (open().query("SELECT COUNT(*) AS n FROM memories").get() as { n: number }).n
            return { content: `${lines.join("\n")}\n\n${rows.length} shown, ${total} total across all projects.` }
          } catch (error) {
            const message = errorMessage(error)
            log(`memory_list failed: ${message}`)
            return { content: `Failed to list: ${message}` }
          }
        },
      })

      editor.add({
        name: "memory_forget",
        description:
          "Delete a memory by id. Get ids from memory_list or the Memory block. Use when a fact is wrong" +
          " or obsolete, or the user asks to forget it.",
        input: {
          type: "object",
          properties: { id: { type: "integer", description: "The id shown in brackets." } },
          required: ["id"],
          additionalProperties: false,
        },
        async execute(input) {
          const id = int((input as ForgetInput).id)
          if (id === undefined) return { content: "Nothing deleted: id must be an integer." }
          try {
            const row = open().query("SELECT content FROM memories WHERE id = ?").get(id) as { content: string } | null
            if (!row) return { content: `No memory with id ${id}.` }
            open().run("DELETE FROM memories WHERE id = ?", [id])
            exportMarkdown()
            return { content: `Forgot [${id}]: ${row.content}` }
          } catch (error) {
            const message = errorMessage(error)
            log(`memory_forget failed: ${message}`)
            return { content: `Failed to delete: ${message}` }
          }
        },
      })

      editor.add({
        name: "memory_pin",
        description:
          "Pin or unpin a memory. Pinned entries are injected first and are never evicted when the row" +
          " cap is reached. Use for facts that must always be present.",
        input: {
          type: "object",
          properties: {
            id: { type: "integer", description: "The id shown in brackets." },
            pinned: { type: "boolean", description: "true to pin, false to unpin." },
          },
          required: ["id", "pinned"],
          additionalProperties: false,
        },
        async execute(input) {
          const args = input as PinInput
          const id = int(args.id)
          if (id === undefined) return { content: "Nothing changed: id must be an integer." }
          const pinned = args.pinned === true
          try {
            const row = open().query("SELECT id FROM memories WHERE id = ?").get(id)
            if (!row) return { content: `No memory with id ${id}.` }
            open().run("UPDATE memories SET pinned = ?, updated_at = ? WHERE id = ?", [pinned ? 1 : 0, now(), id])
            exportMarkdown()
            return { content: `[${id}] ${pinned ? "pinned" : "unpinned"}.` }
          } catch (error) {
            const message = errorMessage(error)
            log(`memory_pin failed: ${message}`)
            return { content: `Failed to update: ${message}` }
          }
        },
      })
    })

    // Session titles. The event stream carries every location's events and the
    // events themselves carry no location (verified on 2.0.22), so each session is
    // looked up once and cached; only sessions rooted at this instance's directory
    // are recorded. Bounded cache: contents are re-derivable from the server.
    const seen = new Map<string, { title: string; directory: string | undefined }>()
    const controller = new AbortController()

    const cache = (id: string, entry: { title: string; directory: string | undefined }) => {
      if (seen.size > 200) seen.clear()
      seen.set(id, entry)
    }

    const settle = async (id: string) => {
      const hit = seen.get(id)
      if (hit?.directory !== undefined) {
        if (hit.title) remember(id, hit.title, hit.directory)
        return
      }
      try {
        const info = await ctx.session.get({ sessionID: id })
        const entry = { title: info.title ?? hit?.title ?? "", directory: info.location.directory }
        cache(id, entry)
        if (entry.title) remember(id, entry.title, entry.directory)
      } catch (error) {
        log(`failed to look up session ${id}: ${errorMessage(error)}`)
      }
    }

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event.type === "session.renamed") {
            const id = event.data.sessionID
            const dir = event.location?.directory ?? seen.get(id)?.directory
            cache(id, { title: event.data.title, directory: dir })
            if (dir !== undefined && event.data.title) remember(id, event.data.title, dir)
            continue
          }
          // End of a turn. session.idle is kept for older servers that still emit it.
          if (
            event.type === "session.execution.succeeded" ||
            event.type === "session.execution.failed" ||
            event.type === "session.execution.interrupted" ||
            event.type === "session.idle"
          ) {
            await settle(event.data.sessionID)
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) log(`event subscription ended: ${errorMessage(error)}`)
      }
    })()

    return () => {
      controller.abort()
      db?.close()
      db = undefined
    }
  },
}

export default plugin
