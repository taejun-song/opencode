// Rubric dimensions, checks, score aggregation, and the gate verdict.
// 1:1 port of reposkillopt_engine/rubric.py.

export const DIMENSIONS: readonly string[] = [
  "architectural_correctness",
  "evidence_quality",
  "citation_validity",
  "file_symbol_grounding",
  "hallucination_avoidance",
  "change_localization",
  "usefulness",
  "risk_awareness",
  "fact_hypothesis_distinction",
  "test_strategy_quality",
  "feedback_responsiveness",
  "spec_completeness",
  "spec_maintainability",
  "cross_agent_portability",
  "failure_mode_resistance",
]

export const CHECKS: readonly string[] = [
  "cited_paths_exist",
  "cited_symbols_exist",
  "sections_present",
  "unsupported_claims_marked",
  "no_hallucinated_refs",
  "prior_feedback_addressed",
  "adapter_preserves_intent",
]

export enum Verdict {
  PASS = "PASS",
  FAIL = "FAIL",
  HELD = "HELD",
}

export class ScoreCard {
  scores: Record<string, number>
  checks: Record<string, boolean>
  constructor(scores: Record<string, number>, checks: Record<string, boolean>) {
    this.scores = scores
    this.checks = checks
  }
  validate(): void {
    for (const d of DIMENSIONS) {
      const v = this.scores[d]
      if (!Number.isInteger(v) || v < 0 || v > 3) {
        throw new Error(`dimension ${JSON.stringify(d)} must be an int 0-3, got ${JSON.stringify(v)}`)
      }
    }
    for (const c of CHECKS) {
      if (typeof this.checks[c] !== "boolean") {
        throw new Error(`check ${JSON.stringify(c)} must be bool`)
      }
    }
  }
}

export interface DimAggregate {
  dimension: string
  baseline: number
  aggregate: number
  method: "majority" | "median"
  range: number
  low_agreement: boolean
  vs_baseline: "above" | "equal" | "below"
}

// statistics.median: average of the two middle values for even-length, sorted.
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  const mid = Math.floor(n / 2)
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Counter.most_common(1): the value with the highest count; ties broken by
// FIRST-INSERTION order (Python Counter preserves insertion order). Mirror that.
function mostCommon(values: number[]): [number, number] {
  const counts = new Map<number, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let bestVal = values[0]
  let bestN = -1
  for (const [val, n] of counts) {
    if (n > bestN) {
      bestN = n
      bestVal = val
    }
  }
  return [bestVal, bestN]
}

function aggregateDimension(values: number[]): [number, "majority" | "median", number, boolean] {
  const [top, topN] = mostCommon(values)
  let agg: number
  let method: "majority" | "median"
  if (topN * 2 > values.length) {
    agg = top
    method = "majority"
  } else {
    // Python: int(statistics.median(values)) — truncates toward zero (scores are >=0)
    agg = Math.trunc(median(values))
    method = "median"
  }
  const rng = Math.max(...values) - Math.min(...values)
  return [agg, method, rng, rng >= 2]
}

export function aggregate(
  cards: ScoreCard[],
  baseline: Record<string, number>,
): [DimAggregate[], Record<string, boolean>] {
  if (cards.length === 0) throw new Error("no score cards to aggregate")
  const dims: DimAggregate[] = []
  for (const d of DIMENSIONS) {
    const vals = cards.map((c) => c.scores[d])
    const [agg, method, rng, low] = aggregateDimension(vals)
    const b = d in baseline ? baseline[d] : agg
    const vs = agg > b ? "above" : agg < b ? "below" : "equal"
    dims.push({ dimension: d, baseline: b, aggregate: agg, method, range: rng, low_agreement: low, vs_baseline: vs })
  }
  const checks: Record<string, boolean> = {}
  for (const c of CHECKS) {
    const passes = cards.filter((card) => card.checks[c]).length
    checks[c] = passes * 2 > cards.length
  }
  return [dims, checks]
}

export interface RepoResult {
  repo: string
  dims: DimAggregate[]
  checks: Record<string, boolean>
  adjudicated: Set<string>
}

export function verdictFor(results: RepoResult[], effectRealized = true): Verdict {
  let held = false
  for (const r of results) {
    if (Object.values(r.checks).some((ok) => !ok)) return Verdict.FAIL
    for (const d of r.dims) {
      if (d.aggregate < d.baseline) return Verdict.FAIL
      if (d.low_agreement && (d.vs_baseline === "equal" || d.vs_baseline === "below") && !r.adjudicated.has(d.dimension)) {
        held = true
      }
    }
  }
  if (held) return Verdict.HELD
  if (!effectRealized) return Verdict.FAIL
  return Verdict.PASS
}
