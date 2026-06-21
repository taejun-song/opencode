// Validation gate + the validation-gated convergence loop (native backend only).
// 1:1 port of reposkillopt_engine/gate.py + optimizer.py (native path; the SkillOpt
// backend is intentionally not ported — research D4).

import { type LLMProvider } from "./provider"
import { generateSpec, scoreSpec } from "./judge"
import { proposeEdit } from "./judge"
import { ProposalError } from "./proposal"
import { bump } from "./version"
import {
  Verdict,
  aggregate,
  verdictFor,
  type RepoResult,
  type ScoreCard,
} from "./rubric"

export interface HeldOutRepo {
  name: string
  commit: string
  content: string // repo material handed to the provider
  baseline: Record<string, number> // per-dimension baseline scores
}

export class GateConfig {
  mode: "single" | "majority" = "single"
  n = 1
  effectRealized = true
  constructor(init?: Partial<GateConfig>) {
    Object.assign(this, init)
  }
  scorers(): number {
    if (this.mode === "majority") {
      if (this.n < 3 || this.n % 2 === 0) throw new Error("majority mode requires an odd N >= 3")
      return this.n
    }
    return 1
  }
}

export interface GateResult {
  verdict: Verdict
  results: RepoResult[]
}

export async function runGate(
  provider: LLMProvider,
  skillText: string,
  repos: HeldOutRepo[],
  config: GateConfig = new GateConfig(),
): Promise<GateResult> {
  const n = config.scorers()
  const results: RepoResult[] = []
  for (const repo of repos) {
    const spec = await generateSpec(provider, skillText, repo.name, repo.content)
    const cards: ScoreCard[] = []
    for (let i = 0; i < n; i++) cards.push(await scoreSpec(provider, spec, repo.name))
    const [dims, checks] = aggregate(cards, repo.baseline)
    results.push({ repo: repo.name, dims, checks, adjudicated: new Set() })
  }
  const verdict = verdictFor(results, config.effectRealized)
  return { verdict, results }
}

export interface Round {
  index: number
  editKind: string
  verdict: string
  accepted: boolean
  version: string
  note: string
}

export class OptimizerConfig {
  maxRounds = 10
  patience = 2
  guidance = "Improve evidence grounding and secondary-structure coverage."
  gate: GateConfig = new GateConfig()
  constructor(init?: Partial<OptimizerConfig>) {
    Object.assign(this, init)
  }
}

export interface OptimizerResult {
  skillText: string
  version: string
  history: Round[]
}

export function acceptedCount(r: OptimizerResult): number {
  return r.history.filter((h) => h.accepted).length
}

export async function optimize(
  provider: LLMProvider,
  skillText: string,
  version: string,
  repos: HeldOutRepo[],
  config: OptimizerConfig = new OptimizerConfig(),
): Promise<OptimizerResult> {
  const result: OptimizerResult = { skillText, version, history: [] }
  let misses = 0

  for (let i = 1; i <= config.maxRounds; i++) {
    const proposal = await proposeEdit(provider, result.skillText, config.guidance)
    if (proposal.isTerminal) {
      result.history.push({ index: i, editKind: "NONE", verdict: "-", accepted: false, version: result.version, note: "converged: no further edit" })
      break
    }
    if (!proposal.eligible()) {
      misses += 1
      result.history.push({ index: i, editKind: proposal.editKind, verdict: "-", accepted: false, version: result.version, note: "skipped: not generic / not eligible" })
      if (misses >= config.patience) break
      continue
    }

    let candidate: string
    try {
      candidate = proposal.apply(result.skillText)
    } catch (exc) {
      if (exc instanceof ProposalError) {
        misses += 1
        result.history.push({ index: i, editKind: proposal.editKind, verdict: "-", accepted: false, version: result.version, note: `apply failed: ${exc.message}` })
        if (misses >= config.patience) break
        continue
      }
      throw exc
    }

    const gate = await runGate(provider, candidate, repos, config.gate)
    const label = gate.verdict
    const accepted = gate.verdict === Verdict.PASS
    if (accepted) {
      result.skillText = candidate
      result.version = bump(result.version, proposal.bumpLevel)
      misses = 0
    } else {
      misses += 1
    }
    result.history.push({ index: i, editKind: proposal.editKind, verdict: label, accepted, version: result.version, note: "" })
    if (!accepted && misses >= config.patience) break
  }

  return result
}
