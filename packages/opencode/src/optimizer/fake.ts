// Deterministic, offline provider — 1:1 port of reposkillopt_engine/providers/fake.py.
// Routes by the markers the judge puts in prompts and returns scripted responses
// from per-phase queues. No network. Drives --dry-run and the parity/loop tests.

import { type LLMProvider, ProviderError } from "./provider"
import { DIMENSIONS, CHECKS } from "./rubric"

export class FakeProvider implements LLMProvider {
  readonly name = "fake"
  private specText: string
  private scores: unknown[]
  private proposals: unknown[]
  calls: string[] = []

  constructor(opts?: { specText?: string; scores?: unknown[]; proposals?: unknown[] }) {
    this.specText = opts?.specText ?? "# regenerated spec (fake)\n"
    this.scores = [...(opts?.scores ?? [])]
    this.proposals = [...(opts?.proposals ?? [])]
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async complete(prompt: string, _opts?: { system?: string }): Promise<string> {
    if (prompt.includes("REGENERATE_SPEC")) {
      this.calls.push("regenerate")
      return this.specText
    }
    if (prompt.includes("SCORE_SPEC")) {
      this.calls.push("score")
      if (this.scores.length === 0) throw new ProviderError("FakeProvider: no scripted scores left")
      return JSON.stringify(this.scores.shift())
    }
    if (prompt.includes("PROPOSE_EDIT")) {
      this.calls.push("propose")
      if (this.proposals.length === 0) return JSON.stringify({ edit_kind: "NONE" })
      return JSON.stringify(this.proposals.shift())
    }
    throw new ProviderError("FakeProvider: unrecognized prompt phase")
  }
}

/**
 * Deterministic offline provider for `--dry-run`: returns CONSTANT responses for
 * every phase (a minimal spec, an all-2s scorecard, and NONE), so the loop
 * converges immediately and the output layout is produced with no network and no
 * scripted queue to exhaust. Distinct from FakeProvider (whose finite queues drive
 * the parity/loop tests and faithfully throw when empty).
 */
export class DryRunProvider implements LLMProvider {
  readonly name = "dry-run"
  private readonly scorecard: string
  constructor() {
    const scores: Record<string, number> = {}
    DIMENSIONS.forEach((d) => (scores[d] = 2))
    const checks: Record<string, string> = {}
    CHECKS.forEach((c) => (checks[c] = "pass"))
    this.scorecard = JSON.stringify({ scores, checks })
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  async complete(prompt: string): Promise<string> {
    if (prompt.includes("REGENERATE_SPEC")) return "# Repository Specification (dry-run)\n"
    if (prompt.includes("SCORE_SPEC")) return this.scorecard
    if (prompt.includes("PROPOSE_EDIT")) return JSON.stringify({ edit_kind: "NONE" })
    throw new ProviderError("DryRunProvider: unrecognized prompt phase")
  }
}
