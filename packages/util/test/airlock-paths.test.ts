import { describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"

// airlock: the installer writes ~/.config/airlock etc.; the engine must read the same paths even when
// XDG_* variables point elsewhere (CI runners and some desktops set them). XDG is honoured only with
// AIRLOCK_HONOR_XDG=1. AIRLOCK_* variables alias the engine's OPENCODE_* flags.
const globalModule = pathToFileURL(path.join(import.meta.dir, "../src/global.ts")).href
const envModule = pathToFileURL(path.join(import.meta.dir, "../src/airlock-env.ts")).href

function spawn(code: string, env: Record<string, string | undefined>) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("XDG_") && !k.startsWith("AIRLOCK_") && !k.startsWith("OPENCODE_")))
  const result = Bun.spawnSync({ cmd: [process.execPath, "-e", code], env: { ...clean, ...env } as Record<string, string>, stdout: "pipe", stderr: "pipe" })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
  return JSON.parse(result.stdout.toString().trim().split("\n").pop()!)
}
const paths = (env: Record<string, string | undefined>) =>
  spawn(`const g = await import(${JSON.stringify(globalModule)}); console.log(JSON.stringify(g.Path))`, env)
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p))

describe("airlock layout", () => {
  test("is airlock-named and $HOME-relative even when XDG_* is set", () => {
    const home = tmp("al-home-")
    const xdg = tmp("al-xdg-")
    const p = paths({ HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: xdg, XDG_CACHE_HOME: xdg, XDG_DATA_HOME: xdg, XDG_STATE_HOME: xdg })
    expect(p.config).toBe(path.join(home, ".config", "airlock"))
    expect(p.cache).toBe(path.join(home, ".cache", "airlock"))
    expect(p.data).toBe(path.join(home, ".local", "share", "airlock"))
    expect(p.state).toBe(path.join(home, ".local", "state", "airlock"))
  })

  test("honours XDG_* only with AIRLOCK_HONOR_XDG=1", () => {
    const xdg = tmp("al-xdg-")
    const p = paths({ HOME: tmp("al-home-"), AIRLOCK_HONOR_XDG: "1", XDG_CONFIG_HOME: xdg })
    expect(p.config).toBe(path.join(xdg, "airlock"))
  })

  test("AIRLOCK_TEST_HOME (alias of OPENCODE_TEST_HOME) moves every root", () => {
    const home = tmp("al-th-")
    const p = paths({ HOME: tmp("al-home-"), AIRLOCK_TEST_HOME: home })
    expect(p.home).toBe(home)
    expect(p.config).toBe(path.join(home, ".config", "airlock"))
  })
})

describe("AIRLOCK_* env aliases", () => {
  const run = (env: Record<string, string | undefined>) =>
    spawn(`await import(${JSON.stringify(envModule)}); console.log(JSON.stringify({ a: process.env.OPENCODE_DISABLE_AUTOUPDATE ?? null, b: process.env.OPENCODE_DB ?? null }))`, env)

  test("copies AIRLOCK_X to OPENCODE_X when unset", () => {
    expect(run({ AIRLOCK_DISABLE_AUTOUPDATE: "1" }).a).toBe("1")
  })
  test("never overrides an explicit OPENCODE_X", () => {
    expect(run({ AIRLOCK_DB: "/tmp/a.db", OPENCODE_DB: "/tmp/b.db" }).b).toBe("/tmp/b.db")
  })
})
