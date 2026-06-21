// Deterministic grounding of a Repository Specification against the real repo.
// 1:1 port of reposkillopt_engine/grounding.py. No LLM, no network.
//
// Parity notes (Python -> TS):
//  * str.replace("\n"," ") replaces ALL in Python -> use replaceAll.
//  * line counting mirrors Python text-mode iteration with universal newlines.
//  * re.escape -> escape every non-word char; \b word boundaries match for ASCII.

import * as fs from "node:fs"
import * as path from "node:path"
import { CHECKS } from "./rubric"

export const REQUIRED_SECTIONS: readonly string[] = [
  "Repository overview",
  "Technology stack",
  "Build and runtime commands",
  "Major entrypoints",
  "Architectural layers",
  "Core modules",
  "Domain model",
  "Data model",
  "External integrations",
  "Control-flow traces",
  "Data-flow traces",
  "Dependency map",
  "Configuration map",
  "Testing strategy",
  "Deployment assumptions",
  "Change-impact map",
  "Known risks",
  "Unknowns and unresolved questions",
  "Evidence index",
]

// path-with-letter-initial-extension ":" locator (":" line2 optional). Named groups.
const CIT_SOURCE =
  "(?<path>[A-Za-z0-9_][A-Za-z0-9_./\\-]*\\.[A-Za-z][A-Za-z0-9_]*)" +
  ":(?<loc>\\d+(?:-\\d+)?(?:,\\d+)*|[A-Za-z_][A-Za-z0-9_]*)" +
  "(?::(?<line2>\\d+))?"
const FACT_SOURCE = "\\*\\*\\[fact\\]\\*\\*"

function citRegexGlobal(): RegExp {
  return new RegExp(CIT_SOURCE, "g")
}
function citRegexSearch(): RegExp {
  return new RegExp(CIT_SOURCE)
}

export type CitationKind = "line" | "range" | "symbol" | "symbol_line" | "malformed"

export interface Citation {
  raw: string
  path: string
  kind: CitationKind
  line?: number
  start?: number
  end?: number
  symbol?: string
}

export interface GroundingResult {
  citations: Citation[]
  resolved: number
  resolvableTotal: number
  rate: number
  checks: Record<string, boolean>
  failures: string[]
}

export function parseCitations(specText: string): Citation[] {
  const out: Citation[] = []
  for (const m of specText.matchAll(citRegexGlobal())) {
    const g = m.groups!
    const p = g["path"]
    const loc = g["loc"]
    const line2 = g["line2"]
    const raw = m[0]
    if (/^\d+$/.test(loc)) {
      out.push({ raw, path: p, kind: "line", line: parseInt(loc, 10) })
    } else if (/^\d+-\d+$/.test(loc)) {
      const [a, b] = loc.split("-")
      out.push({ raw, path: p, kind: "range", start: parseInt(a, 10), end: parseInt(b, 10) })
    } else if (/^\d+(?:,\d+)+$/.test(loc)) {
      for (const n of loc.split(",")) {
        out.push({ raw: `${p}:${n}`, path: p, kind: "line", line: parseInt(n, 10) })
      }
    } else {
      if (line2) {
        out.push({ raw, path: p, kind: "symbol_line", symbol: loc, line: parseInt(line2, 10) })
      } else {
        out.push({ raw, path: p, kind: "symbol", symbol: loc })
      }
    }
  }
  return out
}

function lineCount(fp: string, cache: Map<string, number>): number {
  if (!cache.has(fp)) {
    try {
      const raw = fs.readFileSync(fp, "utf-8")
      const s = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n") // universal newlines
      let n: number
      if (s === "") n = 0
      else n = (s.match(/\n/g)?.length ?? 0) + (s.endsWith("\n") ? 0 : 1)
      cache.set(fp, n)
    } catch {
      cache.set(fp, -1)
    }
  }
  return cache.get(fp)!
}

function escapeRegExp(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, (c) => "\\" + c)
}

function resolve(
  repo: string,
  c: Citation,
  lcCache: Map<string, number>,
  txtCache: Map<string, string>,
): [boolean, string] {
  const fp = path.join(repo, c.path)
  let isFile = false
  try {
    isFile = fs.statSync(fp).isFile()
  } catch {
    isFile = false
  }
  if (!isFile) return [false, `file "${c.path}" does not exist`]
  const n = lineCount(fp, lcCache)
  if (c.kind === "line") {
    const ok = 1 <= c.line! && c.line! <= n
    return [ok, ok ? "" : `line ${c.line} out of range (file has ${n})`]
  }
  if (c.kind === "range") {
    const ok = 1 <= c.start! && c.start! <= c.end! && c.end! <= n
    return [ok, ok ? "" : `range ${c.start}-${c.end} out of range (file has ${n})`]
  }
  if (c.kind === "symbol" || c.kind === "symbol_line") {
    if (!txtCache.has(fp)) {
      try {
        txtCache.set(fp, fs.readFileSync(fp, "utf-8"))
      } catch {
        txtCache.set(fp, "")
      }
    }
    const found = new RegExp(`\\b${escapeRegExp(c.symbol!)}\\b`).test(txtCache.get(fp)!)
    if (!found) return [false, `symbol "${c.symbol}" not found in ${c.path}`]
    if (c.kind === "symbol_line" && !(1 <= c.line! && c.line! <= n)) {
      return [false, `line ${c.line} out of range (file has ${n})`]
    }
    return [true, ""]
  }
  return [false, "malformed citation"]
}

function unmarkedFact(specText: string): string | null {
  for (const m of specText.matchAll(new RegExp(FACT_SOURCE, "g"))) {
    const end = m.index! + m[0].length
    const tail = specText.slice(end, end + 90)
    if (tail.includes("`") || citRegexSearch().test(tail) || tail.includes("cmd:")) continue
    return specText.slice(end, end + 40).trim().replaceAll("\n", " ")
  }
  return null
}

export function groundSpec(
  repoPath: string,
  specText: string,
  hallucinationThreshold = 0.9,
): GroundingResult {
  const g: GroundingResult = {
    citations: parseCitations(specText),
    resolved: 0,
    resolvableTotal: 0,
    rate: 1.0,
    checks: {},
    failures: [],
  }
  const lcCache = new Map<string, number>()
  const txtCache = new Map<string, string>()

  const considered = g.citations.filter((c) => c.kind !== "malformed")
  let pathsOk = true
  let symbolsOk = true
  for (const c of considered) {
    const [ok, reason] = resolve(repoPath, c, lcCache, txtCache)
    if (ok) {
      g.resolved += 1
    } else {
      g.failures.push(`cited "${c.raw}" — ${reason}`)
      if (reason.includes("does not exist")) pathsOk = false
      if (c.kind === "symbol" || c.kind === "symbol_line") symbolsOk = false
    }
  }
  g.resolvableTotal = considered.length
  g.rate = g.resolvableTotal ? g.resolved / g.resolvableTotal : 1.0

  const specLower = specText.toLowerCase()
  const missing = REQUIRED_SECTIONS.filter((s) => !specLower.includes(s.toLowerCase()))
  for (const s of missing) g.failures.push(`required section "${s}" missing`)

  const unmarked = unmarkedFact(specText)
  if (unmarked !== null) g.failures.push(`"[fact]" claim without a citation near "${unmarked}…"`)

  g.checks = {
    cited_paths_exist: pathsOk,
    cited_symbols_exist: symbolsOk,
    sections_present: missing.length === 0,
    unsupported_claims_marked: unmarked === null,
    no_hallucinated_refs: g.rate >= hallucinationThreshold,
    prior_feedback_addressed: true,
    adapter_preserves_intent: true,
  }
  // keep in lockstep with the rubric's 7 checks
  const keys = new Set(Object.keys(g.checks))
  if (keys.size !== CHECKS.length || !CHECKS.every((c) => keys.has(c))) {
    throw new Error("grounding checks out of sync with rubric CHECKS")
  }
  return g
}
