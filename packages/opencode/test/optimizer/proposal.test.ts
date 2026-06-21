import { test, expect, describe } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import { Proposal, type ProposalInit } from "../../src/optimizer/proposal"
import { bump } from "../../src/optimizer/version"

const FIX = path.join(import.meta.dir, "fixtures")
const proposalGolden = JSON.parse(fs.readFileSync(path.join(FIX, "golden", "proposal-apply.json"), "utf-8"))
const versionGolden = JSON.parse(fs.readFileSync(path.join(FIX, "golden", "version.json"), "utf-8"))

const SKILL = "Alpha line.\nBeta line.\nGamma line.\n"
const cases: ProposalInit[] = [
  { edit_kind: "ADD", anchor: "Beta line.", payload: " (added)" },
  { edit_kind: "ADD", payload: "Appended.\n" },
  { edit_kind: "REPLACE", anchor: "Gamma line.", payload: "Delta line." },
  { edit_kind: "DELETE", anchor: "Alpha line.\n" },
  { edit_kind: "REPLACE", anchor: "Missing.", payload: "x" },
  { edit_kind: "ADD", anchor: "Beta line.", payload: " $& literal" },
  { edit_kind: "NONE" },
]

describe("proposal parity", () => {
  test("apply results/errors match the Python golden exactly", () => {
    const got = cases.map((c) => {
      try {
        const prop = Proposal.fromObject(c)
        return { case: c, ok: true, result: prop.apply(SKILL), eligible: prop.eligible(), isTerminal: prop.isTerminal }
      } catch (e) {
        return { case: c, ok: false, error: (e as Error).constructor.name }
      }
    })
    expect(got).toEqual(proposalGolden)
  })
})

describe("version parity", () => {
  test("bump matches the Python golden", () => {
    expect({
      "0.2.0|minor": bump("0.2.0", "minor"),
      "0.2.0|major": bump("0.2.0", "major"),
      "1.4.9|patch": bump("1.4.9", "patch"),
    }).toEqual(versionGolden)
  })
})
