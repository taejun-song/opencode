import { describe, expect, test } from "bun:test"
import path from "path"
import os from "os"

// airlock: the installer writes ~/.config/airlock etc.; the engine must read the same paths
// even when XDG_* variables point elsewhere (CI runners and some desktops set them).
async function pathsWith(env: Record<string, string>) {
  const proc = Bun.spawn(
    [process.execPath, "-e", 'const g = await import("@opencode-ai/core/global"); console.log(JSON.stringify(g.Global?.Path ?? g.Path))'],
    { env: { ...process.env, ...env }, cwd: path.join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" },
  )
  const out = await new Response(proc.stdout).text()
  await proc.exited
  return JSON.parse(out.trim().split("\n").pop()!)
}

describe("airlock layout", () => {
  test("ignores XDG_* by default", async () => {
    const home = await import("fs").then((fs) => fs.mkdtempSync(path.join(os.tmpdir(), "al-home-")))
    const xdg = await import("fs").then((fs) => fs.mkdtempSync(path.join(os.tmpdir(), "al-xdg-")))
    const p = await pathsWith({ OPENCODE_TEST_HOME: home, XDG_CONFIG_HOME: xdg, XDG_CACHE_HOME: xdg, XDG_DATA_HOME: xdg, XDG_STATE_HOME: xdg })
    expect(p.config).toBe(path.join(home, ".config", "airlock"))
    expect(p.cache).toBe(path.join(home, ".cache", "airlock"))
    expect(p.data).toBe(path.join(home, ".local", "share", "airlock"))
    expect(p.state).toBe(path.join(home, ".local", "state", "airlock"))
  })
  test("honours XDG_* only with AIRLOCK_HONOR_XDG=1", async () => {
    const xdg = await import("fs").then((fs) => fs.mkdtempSync(path.join(os.tmpdir(), "al-xdg-")))
    const p = await pathsWith({ AIRLOCK_HONOR_XDG: "1", XDG_CONFIG_HOME: xdg })
    expect(p.config).toBe(path.join(xdg, "airlock"))
  })
})
