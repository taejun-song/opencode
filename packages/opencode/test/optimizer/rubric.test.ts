import { test, expect, describe } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import { DIMENSIONS, CHECKS, ScoreCard, aggregate, verdictFor, type RepoResult } from "../../src/optimizer/rubric"

const FIX = path.join(import.meta.dir, "fixtures")
const golden = JSON.parse(fs.readFileSync(path.join(FIX, "golden", "scorecard-aggregate.json"), "utf-8"))

function card(scorevals: number[], checkvals: boolean[]): ScoreCard {
  const scores: Record<string, number> = {}
  DIMENSIONS.forEach((d, i) => (scores[d] = scorevals[i]))
  const checks: Record<string, boolean> = {}
  CHECKS.forEach((c, i) => (checks[c] = checkvals[i]))
  return new ScoreCard(scores, checks)
}

describe("rubric parity", () => {
  test("aggregate + verdictFor match the Python golden exactly", () => {
    const s1 = [2, 3, 2, 2, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]
    const s2 = [2, 1, 2, 2, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]
    const s3 = [2, 3, 2, 0, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]
    const allpass = CHECKS.map(() => true)
    const cards = [card(s1, allpass), card(s2, allpass), card(s3, allpass)]
    const baseline: Record<string, number> = {}
    DIMENSIONS.forEach((d) => (baseline[d] = 2))

    const [dims, checks] = aggregate(cards, baseline)
    const rr: RepoResult = { repo: "demo", dims, checks, adjudicated: new Set() }
    const verdict = verdictFor([rr])

    expect({ dims, checks, verdict }).toEqual(golden)
  })
})
