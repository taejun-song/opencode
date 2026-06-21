import { test, expect, describe } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import { groundSpec, type Citation } from "../../src/optimizer/grounding"

const FIX = path.join(import.meta.dir, "fixtures")
const golden = JSON.parse(fs.readFileSync(path.join(FIX, "golden", "grounding.json"), "utf-8"))
const spec = fs.readFileSync(path.join(FIX, "spec.md"), "utf-8")

// mirror the Python gen harness's cit_to_dict (only-present optional keys)
function citDict(c: Citation): Record<string, unknown> {
  const d: Record<string, unknown> = { raw: c.raw, path: c.path, kind: c.kind }
  for (const k of ["line", "start", "end", "symbol"] as const) {
    if (c[k] !== undefined) d[k] = c[k]
  }
  return d
}

describe("grounding parity", () => {
  test("groundSpec matches the Python golden exactly", () => {
    const g = groundSpec(path.join(FIX, "repo"), spec)
    const got = {
      citations: g.citations.map(citDict),
      resolved: g.resolved,
      resolvableTotal: g.resolvableTotal,
      rate: g.rate,
      checks: g.checks,
      failures: g.failures,
    }
    expect(got).toEqual(golden)
  })
})
