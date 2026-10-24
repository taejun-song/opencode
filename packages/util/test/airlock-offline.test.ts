import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { Npm } from "../src/npm.js"

// airlock: the engine runs in networks with no internet. Update checks and model-catalog fetches are
// off by default, and runtime npm installs (plugins, provider SDKs, formatters) need an explicit opt-in.
const envModule = pathToFileURL(path.join(import.meta.dir, "../src/airlock-env.ts")).href
function env(vars: Record<string, string>) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("AIRLOCK_") && !k.startsWith("OPENCODE_")))
  const r = Bun.spawnSync({
    cmd: [process.execPath, "-e", `await import(${JSON.stringify(envModule)}); console.log(JSON.stringify({ u: process.env.OPENCODE_DISABLE_AUTOUPDATE, m: process.env.OPENCODE_DISABLE_MODELS_FETCH }))`],
    env: { ...clean, ...vars } as Record<string, string>,
    stdout: "pipe",
  })
  return JSON.parse(r.stdout.toString())
}

describe("airlock offline defaults", () => {
  test("update checks and model-catalog fetches are off unless explicitly set", () => {
    expect(env({})).toEqual({ u: "1", m: "1" })
    expect(env({ OPENCODE_DISABLE_MODELS_FETCH: "0" }).m).toBe("0")
  })
  test("runtime npm installs need AIRLOCK_NPM_INSTALL=1", () => {
    expect(Npm.installAllowed({})).toBe(false)
    expect(Npm.installAllowed({ OPENCODE_NPM_INSTALL: "1" })).toBe(true)
  })
  test("the install routine consults the gate", async () => {
    const src = await Bun.file(path.join(import.meta.dir, "../src/npm.ts")).text()
    expect(src).toMatch(/if \(!installAllowed\(process\.env\)\)/)
  })
})
