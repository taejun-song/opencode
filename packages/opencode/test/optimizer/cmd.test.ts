import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { DIMENSIONS, CHECKS } from "../../src/optimizer/rubric"
import { FakeProvider } from "../../src/optimizer/fake"
import { runOptimize, OptimizeError } from "../../src/optimizer/run"

const FIX = path.join(import.meta.dir, "fixtures")
const REPO = path.join(FIX, "repo")

function scorecard(val: number) {
  const scores: Record<string, number> = {}
  DIMENSIONS.forEach((d) => (scores[d] = val))
  const checks: Record<string, string> = {}
  CHECKS.forEach((c) => (checks[c] = "pass"))
  return { scores, checks }
}
const eligibleEdit = { edit_kind: "ADD", anchor: "Base skill.", payload: " more", scope: "generic", bump_level: "minor" }

// fresh scripts per run (queues are consumed)
function fake() {
  return new FakeProvider({ specText: "# spec\n", scores: [scorecard(2), scorecard(2), scorecard(2)], proposals: [eligibleEdit] })
}

let tmp: string
let skillPath: string
let outDir: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opt-"))
  skillPath = path.join(tmp, "SKILL.md")
  outDir = path.join(tmp, "out")
  fs.writeFileSync(skillPath, "Base skill.\n")
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe("runOptimize orchestration", () => {
  test("writes the full output set and leaves the installed skill untouched", async () => {
    const before = fs.readFileSync(skillPath, "utf-8")
    const summary = await runOptimize(fake(), { repoDir: REPO, skillPath, outDir, startVersion: "0.2.0" })

    for (const f of ["tuned-SKILL.md", "optimized-repository-specification.md", "grounding-report.md", "session.log"]) {
      expect(fs.existsSync(path.join(outDir, f))).toBe(true)
    }
    // the PASS edit was accepted -> version bumped, tuned skill changed
    expect(summary.accepted).toBe(1)
    expect(summary.finalVersion).toBe("0.3.0")
    expect(fs.readFileSync(path.join(outDir, "tuned-SKILL.md"), "utf-8")).toBe("Base skill. more\n")
    // the installed canonical skill is NEVER modified in place
    expect(fs.readFileSync(skillPath, "utf-8")).toBe(before)
  })

  test("dry-run path (fake provider) makes no network calls and still produces outputs", async () => {
    const summary = await runOptimize(fake(), { repoDir: REPO, skillPath, outDir })
    expect(fs.existsSync(path.join(outDir, "tuned-SKILL.md"))).toBe(true)
    expect(summary.outDir).toBe(outDir)
  })

  test("fails loud on a missing repo directory", async () => {
    await expect(runOptimize(fake(), { repoDir: path.join(tmp, "nope"), skillPath, outDir })).rejects.toBeInstanceOf(OptimizeError)
  })

  test("fails loud on a missing skill file", async () => {
    await expect(runOptimize(fake(), { repoDir: REPO, skillPath: path.join(tmp, "nope.md"), outDir })).rejects.toBeInstanceOf(OptimizeError)
  })
})
