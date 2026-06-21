// Orchestration for the `optimize` command, factored out of the CLI shell so it
// is testable standalone with the FakeProvider (the effectCmd wrapper + the real
// opencode-bound provider are the only integration glue). Builds the evidence
// pack, seeds the per-repo baseline from the starting skill, runs the native
// convergence loop, and writes the collectable outputs — never touching the
// installed canonical skill.

import * as fs from "node:fs"
import * as path from "node:path"
import { type LLMProvider } from "./provider"
import { buildEvidencePack } from "./evidence"
import { generateSpec, scoreSpec } from "./judge"
import { aggregate, DIMENSIONS } from "./rubric"
import { groundSpec } from "./grounding"
import { optimize, runGate, OptimizerConfig, GateConfig, acceptedCount, type HeldOutRepo, type OptimizerResult } from "./optimizer"

export interface RunOptions {
  repoDir: string
  skillPath: string
  outDir: string
  rounds?: number
  startVersion?: string
}

export interface RunSummary {
  outDir: string
  accepted: number
  rounds: number
  finalVersion: string
  citationRate: number
  result: OptimizerResult
}

export class OptimizeError extends Error {}

/** Seed a per-dimension baseline by scoring the starting skill once. */
async function seedBaseline(provider: LLMProvider, skillText: string, repo: HeldOutRepo, gate: GateConfig): Promise<Record<string, number>> {
  const n = gate.scorers()
  const spec = await generateSpec(provider, skillText, repo.name, repo.content)
  const cards = []
  for (let i = 0; i < n; i++) cards.push(await scoreSpec(provider, spec, repo.name))
  const [dims] = aggregate(cards, {})
  const baseline: Record<string, number> = {}
  for (const d of dims) baseline[d.dimension] = d.aggregate
  return baseline
}

export async function runOptimize(provider: LLMProvider, opts: RunOptions): Promise<RunSummary> {
  // --- preconditions (fail-loud) ---
  let isDir = false
  try {
    isDir = fs.statSync(opts.repoDir).isDirectory()
  } catch {
    isDir = false
  }
  if (!isDir) throw new OptimizeError(`not a directory: ${opts.repoDir}`)
  let skillText: string
  try {
    skillText = fs.readFileSync(opts.skillPath, "utf-8")
  } catch {
    throw new OptimizeError(`skill not found: ${opts.skillPath}`)
  }
  if (skillText.trim() === "") throw new OptimizeError(`skill is empty: ${opts.skillPath}`)

  const log: string[] = []
  const note = (m: string) => log.push(m)

  // --- evidence pack (built once, reused) ---
  const pack = buildEvidencePack(opts.repoDir)
  note(`evidence pack: ${pack.text.length} chars, ${pack.includedFiles.length} files`)
  const repo: HeldOutRepo = { name: pack.repoName, commit: "", content: pack.text, baseline: {} }

  const gate = new GateConfig({ mode: "single", n: 1 })
  const config = new OptimizerConfig({ gate, ...(opts.rounds ? { maxRounds: opts.rounds } : {}) })

  // --- seed the baseline from the starting skill (research D7) ---
  repo.baseline = await seedBaseline(provider, skillText, repo, gate)
  note(`baseline seeded for ${DIMENSIONS.length} dimensions`)

  // --- the convergence loop ---
  const result = await optimize(provider, skillText, opts.startVersion ?? "0.1.0", [repo], config)
  for (const r of result.history) note(`round ${r.index}: ${r.editKind} ${r.verdict} ${r.accepted ? "ACCEPT" : "reject"} ${r.note}`)
  note(`final version ${result.version}; ${acceptedCount(result)} accepted of ${result.history.length} rounds`)

  // --- final spec + deterministic grounding report for the best skill ---
  const bestSpec = await generateSpec(provider, result.skillText, repo.name, repo.content)
  const grounding = groundSpec(opts.repoDir, bestSpec)
  const finalGate = await runGate(provider, result.skillText, [repo], gate)
  note(`citation resolution ${(grounding.rate * 100).toFixed(0)}%; final verdict ${finalGate.verdict}`)

  // --- write outputs (never modify the installed skill) ---
  fs.mkdirSync(opts.outDir, { recursive: true })
  fs.writeFileSync(path.join(opts.outDir, "tuned-SKILL.md"), result.skillText)
  fs.writeFileSync(path.join(opts.outDir, "optimized-repository-specification.md"), bestSpec)
  fs.writeFileSync(path.join(opts.outDir, "grounding-report.md"), renderReport(result, grounding, finalGate.verdict))
  fs.writeFileSync(path.join(opts.outDir, "session.log"), log.join("\n") + "\n")

  return {
    outDir: opts.outDir,
    accepted: acceptedCount(result),
    rounds: result.history.length,
    finalVersion: result.version,
    citationRate: grounding.rate,
    result,
  }
}

function renderReport(result: OptimizerResult, grounding: ReturnType<typeof groundSpec>, verdict: string): string {
  const lines = [
    `# Optimization report`,
    ``,
    `- final version: ${result.version}`,
    `- accepted: ${acceptedCount(result)} of ${result.history.length} rounds`,
    `- final gate verdict: ${verdict}`,
    `- citation resolution: ${(grounding.rate * 100).toFixed(0)}% (${grounding.resolved}/${grounding.resolvableTotal})`,
    ``,
    `## Deterministic checks`,
    ...Object.entries(grounding.checks).map(([k, v]) => `- ${k}: ${v ? "pass" : "FAIL"}`),
    ``,
    `## Round history`,
    ...result.history.map((r) => `- round ${r.index}: ${r.editKind} → ${r.verdict} (${r.accepted ? "accepted" : "rejected"})${r.note ? " — " + r.note : ""}`),
    ``,
    `## Grounding failures`,
    ...(grounding.failures.length ? grounding.failures.map((f) => `- ${f}`) : ["- (none)"]),
    ``,
  ]
  return lines.join("\n")
}
