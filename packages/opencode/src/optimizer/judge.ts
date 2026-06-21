// LLM-facing operations: regenerate a spec, score a spec, propose an edit.
// 1:1 port of reposkillopt_engine/judge.py. Each prompt carries a phase marker the
// FakeProvider routes on; JSON is extracted leniently (first balanced object).

import { type LLMProvider, ProviderError } from "./provider"
import { DIMENSIONS, CHECKS, ScoreCard } from "./rubric"
import { Proposal } from "./proposal"
import { sanitizeModelSpec } from "./sanitize"

export function extractJson(text: string): Record<string, any> {
  const start = text.indexOf("{")
  if (start < 0) throw new ProviderError(`no JSON object in response: ${JSON.stringify(text.slice(0, 200))}`)
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth += 1
    else if (text[i] === "}") {
      depth -= 1
      if (depth === 0) return JSON.parse(text.slice(start, i + 1))
    }
  }
  throw new ProviderError("unbalanced JSON in response")
}

export async function generateSpec(
  provider: LLMProvider,
  skillText: string,
  repoName: string,
  repoContent: string,
): Promise<string> {
  const prompt =
    "REGENERATE_SPEC\n" +
    "Apply the following skill to the repository and produce a Repository " +
    "Specification (Markdown) with all 19 sections.\n\n" +
    `<skill>\n${skillText}\n</skill>\n\n` +
    `<repository name="${repoName}">\n${repoContent}\n</repository>\n`
  const raw = await provider.complete(prompt, { system: "You are a careful repository-understanding agent." })
  return sanitizeModelSpec(raw)
}

export async function scoreSpec(provider: LLMProvider, specText: string, repoName: string): Promise<ScoreCard> {
  const dims = DIMENSIONS.join(", ")
  const checks = CHECKS.join(", ")
  const prompt =
    "SCORE_SPEC\n" +
    "Score this Repository Specification against the rubric. Return ONLY JSON: " +
    '{"scores": {<dimension>: 0-3, ...}, "checks": {<check>: "pass"|"fail", ...}}.\n' +
    `Dimensions (all required): ${dims}\n` +
    `Checks (all required): ${checks}\n\n` +
    `<spec repo="${repoName}">\n${specText}\n</spec>\n`
  const raw = await provider.complete(prompt, { system: "You are an exacting evaluation rubric scorer." })
  const obj = extractJson(raw)
  const scores: Record<string, number> = {}
  for (const d of DIMENSIONS) scores[d] = Math.trunc(Number(obj["scores"][d]))
  const outChecks: Record<string, boolean> = {}
  for (const c of CHECKS) outChecks[c] = ["pass", "true", "1"].includes(String(obj["checks"][c]).toLowerCase())
  const card = new ScoreCard(scores, outChecks)
  card.validate()
  return card
}

export async function proposeEdit(provider: LLMProvider, skillText: string, guidance: string): Promise<Proposal> {
  const prompt =
    "PROPOSE_EDIT\n" +
    "Propose ONE bounded, generalizable edit to improve the skill, or return " +
    '{"edit_kind":"NONE"} if no improving edit remains. Return ONLY JSON with keys: ' +
    "edit_kind (ADD|REPLACE|DELETE|REORDER|SPECIALIZE|GENERALIZE|NONE), target_section, " +
    "anchor (exact existing text to locate), payload (new text), expected_effect, " +
    "rationale, scope (generic|repository-scoped), bump_level (major|minor|patch).\n\n" +
    `Guidance: ${guidance}\n\n` +
    `<skill>\n${skillText}\n</skill>\n`
  const raw = await provider.complete(prompt, { system: "You propose bounded, reviewable skill edits." })
  return Proposal.fromObject(extractJson(raw))
}
