import { test, expect, describe } from "bun:test"
import { DIMENSIONS, CHECKS } from "../../src/optimizer/rubric"
import { FakeProvider } from "../../src/optimizer/fake"
import { optimize, OptimizerConfig, GateConfig, type HeldOutRepo, acceptedCount } from "../../src/optimizer/optimizer"

function scorecard(val: number) {
  const scores: Record<string, number> = {}
  DIMENSIONS.forEach((d) => (scores[d] = val))
  const checks: Record<string, string> = {}
  CHECKS.forEach((c) => (checks[c] = "pass"))
  return { scores, checks }
}
function scorecardWithDip(dim: number, val: number) {
  const sc = scorecard(2)
  sc.scores[DIMENSIONS[dim]] = val
  return sc
}

const baseline: Record<string, number> = {}
DIMENSIONS.forEach((d) => (baseline[d] = 2))
const repos: HeldOutRepo[] = [{ name: "demo", commit: "", content: "calc.py: def add", baseline }]
const eligibleEdit = { edit_kind: "ADD", anchor: "Base skill.", payload: " more", scope: "generic", bump_level: "minor" }
const cfg = new OptimizerConfig({ maxRounds: 5, gate: new GateConfig({ mode: "single", n: 1 }) })

describe("optimizer loop (fake provider)", () => {
  test("accepts a PASS edit, bumps the version, then converges on NONE", async () => {
    const fake = new FakeProvider({ specText: "# spec\n", scores: [scorecard(2)], proposals: [eligibleEdit] })
    const res = await optimize(fake, "Base skill.\n", "0.2.0", repos, cfg)
    expect(res.history[0].accepted).toBe(true)
    expect(res.history[0].verdict).toBe("PASS")
    expect(res.version).toBe("0.3.0")
    expect(res.skillText).toBe("Base skill. more\n")
    expect(res.history[1].editKind).toBe("NONE")
    expect(acceptedCount(res)).toBe(1)
  })

  test("rejects a regressing edit (a dimension below baseline -> FAIL), keeps the skill", async () => {
    const fake = new FakeProvider({ specText: "# spec\n", scores: [scorecardWithDip(3, 1)], proposals: [eligibleEdit] })
    const res = await optimize(fake, "Base skill.\n", "0.2.0", repos, cfg)
    expect(res.history[0].accepted).toBe(false)
    expect(res.history[0].verdict).toBe("FAIL")
    expect(res.version).toBe("0.2.0")
    expect(res.skillText).toBe("Base skill.\n")
    expect(acceptedCount(res)).toBe(0)
  })

  test("skips a non-generic (repository-scoped) proposal", async () => {
    const scoped = { ...eligibleEdit, scope: "repository-scoped" }
    const fake = new FakeProvider({ specText: "# spec\n", scores: [], proposals: [scoped] })
    const res = await optimize(fake, "Base skill.\n", "0.2.0", repos, cfg)
    expect(res.history[0].accepted).toBe(false)
    expect(res.history[0].note).toContain("not generic")
  })
})
