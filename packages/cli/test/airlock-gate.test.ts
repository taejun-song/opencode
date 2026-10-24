import { describe, expect, test } from "bun:test"
import { generateKeyPairSync, randomBytes } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

// airlock: the engine binary refuses to run without a valid license when a key is enforced (direct
// invocation cannot bypass the airlock wrapper), except for --version/--help; CI self-test hooks.
const entry = path.join(import.meta.dir, "../src/index.ts")
function cli(args: string[], env: Record<string, string>) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "al-gate-home-"))
  const r = Bun.spawnSync([process.execPath, "run", entry, ...args], {
    env: { ...process.env, HOME: home, OPENCODE_TEST_HOME: home, ...env },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() }
}
function enforcedDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "al-gate-lic-"))
  const pub32 = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).subarray(-32)
  fs.writeFileSync(path.join(dir, "airlock.pub"), `untrusted comment: k\n${Buffer.concat([Buffer.from("Ed"), randomBytes(8), pub32]).toString("base64")}\n`)
  return dir
}

describe("airlock CLI gate", () => {
  test("refuses commands without a license when a key is enforced", () => {
    const r = cli(["models"], { AIRLOCK_LICENSE_DIR: enforcedDir() })
    expect(r.code).toBe(1)
    expect(r.stderr).toContain("[airlock] ERROR: no license installed")
  })
  test("--version is exempt", () => {
    const r = cli(["--version"], { AIRLOCK_LICENSE_DIR: enforcedDir() })
    expect(r.code).toBe(0)
  })
  test("license self-test prints license-ok when enforcement is off", () => {
    const r = cli(["models"], { AIRLOCK_LICENSE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "al-off-")), AIRLOCK_LICENSE_SELFTEST: "1" })
    expect(r.stdout).toBe("license-ok\n")
    expect(r.code).toBe(0)
  })
  test("security self-test prints security-off without a managed profile", () => {
    const r = cli(["models"], {
      AIRLOCK_LICENSE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "al-off-")),
      AIRLOCK_SECURITY_SELFTEST: "1",
      AIRLOCK_SECURITY_SELFTEST_MANAGED_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "al-nomanaged-")),
    })
    expect(r.stdout).toBe("security-off\n")
    expect(r.code).toBe(0)
  })
})
