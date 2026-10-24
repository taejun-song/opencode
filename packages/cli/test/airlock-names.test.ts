import { describe, expect, test } from "bun:test"
import path from "node:path"
import { databasePath } from "../src/database-path"
import { file as logFile } from "@opencode/util/observability/logging"
import { Path } from "@opencode/util/global"

// airlock: the airlock channel keeps the 1.x on-disk names (airlock.db, airlock.log) so the installer,
// `airlock doctor` and migrations find them; upstream channels keep upstream behaviour otherwise.
describe("airlock file names", () => {
  test("the airlock channel uses airlock.db", () => {
    expect(databasePath("/d", "airlock")).toBe(path.resolve("/d", "airlock.db"))
  })
  test("other channels keep a channel-suffixed airlock db", () => {
    expect(databasePath("/d", "local")).toBe(path.resolve("/d", "airlock-local.db"))
  })
  test("OPENCODE_DB still overrides", () => {
    process.env.OPENCODE_DB = ":memory:"
    try { expect(databasePath("/d", "airlock")).toBe(":memory:") } finally { delete process.env.OPENCODE_DB }
  })
  test("log files are airlock-named", () => {
    expect(logFile(false)).toBe(path.join(Path.log, "airlock.log"))
    expect(logFile(true, "airlock")).toBe(path.join(Path.log, "airlock.log"))
    expect(logFile(true, "local")).toBe(path.join(Path.log, "airlock-local.log"))
  })
})

describe("airlock entrypoints", () => {
  const first = (file: string) =>
    Bun.file(path.join(import.meta.dir, "..", file)).text().then((t) => t.split(/\r?\n/).find((l) => l.startsWith("import")))
  test("both CLI entrypoints import the AIRLOCK_* aliases before anything else", async () => {
    expect(await first("src/index.ts")).toBe('import "@opencode/util/airlock-env"')
    expect(await first("src/node/index.ts")).toBe('import "@opencode/util/airlock-env"')
  })
})

describe("airlock build identity", () => {
  const read = (f: string) => Bun.file(path.join(import.meta.dir, "..", f)).text()
  test("the Bun and Node builds bake in the airlock-engine name and the airlock channel", async () => {
    for (const f of ["script/build.ts", "vite.node.config.ts"]) {
      const src = await read(f)
      expect(src, f).toMatch(/OPENCODE_CLI_NAME: (?:"'airlock-engine'"|JSON\.stringify\("airlock-engine"\))/)
      expect(src, f).toMatch(/OPENCODE_CHANNEL: (?:"'airlock'"|JSON\.stringify\("airlock"\))/)
    }
  })
  test("the root command falls back to airlock-engine", async () => {
    expect(await read("src/commands/commands.ts")).toContain('OPENCODE_CLI_NAME : "airlock-engine"')
  })
})

describe("airlock vendor license key", () => {
  test("both builds bake AIRLOCK_LICENSE_PUBKEY_B64 from the build environment", async () => {
    for (const f of ["script/build.ts", "vite.node.config.ts"]) {
      const src = await Bun.file(path.join(import.meta.dir, "..", f)).text()
      expect(src, f).toContain('AIRLOCK_LICENSE_PUBKEY_B64: JSON.stringify(process.env.AIRLOCK_LICENSE_PUBKEY_B64 ?? "")')
    }
  })
})
