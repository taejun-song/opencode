import { describe, expect, test } from "bun:test"
import path from "path"
import { ConfigDiscovery } from "../src/config/discovery"
import { ProjectDir, ConfigNames } from "@opencode/util/global"

// airlock: the installer renders ~/.config/airlock/airlock.json, projects keep settings in .airlock/,
// and deployments put the managed profile in /etc/airlock (overridable for tests, as in 1.x).
describe("airlock config names", () => {
  test("project dir and config file names", () => {
    expect(ProjectDir).toBe(".airlock")
    expect(ConfigNames).toEqual(["airlock.json", "airlock.jsonc"])
    expect(ConfigDiscovery.names).toEqual(["airlock.json", "airlock.jsonc"])
  })
  test("managed (system) config directory is airlock-named on every platform", () => {
    expect(String(ConfigDiscovery.systemDirectory("linux", {}))).toBe("/etc/airlock")
    expect(String(ConfigDiscovery.systemDirectory("darwin", {}))).toBe("/Library/Application Support/airlock")
    expect(String(ConfigDiscovery.systemDirectory("win32", { ProgramData: "D:\\PD" }))).toBe(path.join("D:\\PD", "airlock"))
  })
  test("OPENCODE_TEST_MANAGED_CONFIG_DIR (AIRLOCK_ alias) overrides the managed directory", () => {
    expect(String(ConfigDiscovery.systemDirectory("linux", { OPENCODE_TEST_MANAGED_CONFIG_DIR: "/tmp/m" }))).toBe("/tmp/m")
  })
})

describe("no upstream project-dir or config-name literals left in source", () => {
  test("cli, core and tui sources use the shared constants", async () => {
    const proc = Bun.spawnSync({
      cmd: ["grep", "-rnE", '"\\.opencode"|path\\.join\\([^)]*"\\.opencode"|"opencode\\.jsonc?"', "src", "../cli/src", "../tui/src"],
      cwd: path.join(import.meta.dir, ".."), stdout: "pipe",
    })
    const hits = proc.stdout.toString().split("\n").filter((l) => l && !l.includes("services/updater.ts") && !l.includes("handlers/uninstall.ts") && !l.includes("services/retained-image.ts"))
    expect(hits).toEqual([])
  })
})
