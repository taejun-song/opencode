import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ServerConnection } from "../src/services/server-connection"

// airlock: features that need the internet or that airlock does not ship are disabled with a clear
// message; commands use a private (standalone) engine process unless a service is explicitly enabled.
const entry = path.join(import.meta.dir, "../src/index.ts")
function cli(args: string[]) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "al-off-"))
  const r = Bun.spawnSync([process.execPath, "run", entry, ...args], {
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(OPENCODE|AIRLOCK)_(ALLOW_SELF_UPGRADE|ENABLE_MINI|ENABLE_SERVICE|ALLOW_TUNNEL)$/.test(k))),
      HOME: home,
      OPENCODE_TEST_HOME: home,
      AIRLOCK_LICENSE_DIR: home,
    },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() }
}

describe("airlock disabled commands", () => {
  test("upgrade explains that airlock ships the engine in its bundle", () => {
    const r = cli(["upgrade"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("[airlock] airlock-engine upgrade is not available")
  })
  test("mini is not part of airlock", () => {
    const r = cli(["mini"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("[airlock] airlock-engine mini is not available")
  })
  test("pair --remote (internet tunnel) is refused", () => {
    const r = cli(["pair", "--remote"])
    expect(r.code).toBe(1)
    expect(r.out).toContain("[airlock] pair --remote is not available")
  })
})

describe("airlock standalone default", () => {
  test("commands start a private engine unless --server or an explicitly enabled service", () => {
    expect(ServerConnection.airlockStandalone({}, false, {})).toBe(true)
    expect(ServerConnection.airlockStandalone({}, false, { OPENCODE_ENABLE_SERVICE: "1" })).toBe(false)
    expect(ServerConnection.airlockStandalone({ standalone: true }, false, { OPENCODE_ENABLE_SERVICE: "1" })).toBe(true)
    expect(ServerConnection.airlockStandalone({}, true, { OPENCODE_ENABLE_SERVICE: "1" })).toBe(true)
  })
})
