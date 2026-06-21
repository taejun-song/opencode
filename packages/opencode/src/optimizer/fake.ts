// Deterministic, offline provider — 1:1 port of reposkillopt_engine/providers/fake.py.
// Routes by the markers the judge puts in prompts and returns scripted responses
// from per-phase queues. No network. Drives --dry-run and the parity/loop tests.

import { type LLMProvider, ProviderError } from "./provider"

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
