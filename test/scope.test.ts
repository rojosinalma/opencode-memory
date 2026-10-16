import { expect, test } from "bun:test"
import * as os from "node:os"
import * as path from "node:path"
import { resolveOptions, scopeOf } from "../index.ts"

const home = os.homedir()
const h = (p: string) => path.join(home, p)

test("options: projects_root is optional and expands ~", () => {
  expect(resolveOptions()).toEqual({ projectsRoot: undefined })
  expect(resolveOptions({ projects_root: "~/projects" })).toEqual({ projectsRoot: h("projects") })
  expect(resolveOptions({ projects_root: "/srv/code" })).toEqual({ projectsRoot: "/srv/code" })
  expect(resolveOptions({ projects_root: "" })).toEqual({ projectsRoot: undefined })
})

test("without a projects root the scope is the git root's basename, else the directory name", () => {
  const none = resolveOptions()
  expect(scopeOf(h("projects/app"), h("projects/app/lib"), none)).toBe("app")
  expect(scopeOf("/", "/tmp/scratch", none)).toBe("scratch")
  expect(scopeOf("", "", none)).toBe("global")
})

test("with a projects root, anything under it scopes to the first segment below the root", () => {
  const dev = resolveOptions({ projects_root: "~/projects" })
  expect(scopeOf(h("projects/app"), h("projects/app"), dev)).toBe("app")
  expect(scopeOf(h("projects/app/data/chats/session-1"), h("projects/app/data/chats/session-1"), dev)).toBe("app")
  expect(scopeOf("/", h("projects"), dev)).toBe("projects")
  expect(scopeOf("/", "/tmp/scratch", dev)).toBe("scratch")
  expect(scopeOf(h("other/repo"), h("other/repo/src"), dev)).toBe("repo")
})
