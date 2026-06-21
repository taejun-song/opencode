#!/usr/bin/env python3
"""Generate parity golden fixtures from the pinned reposkillopt engine.

Run from this directory with the engine on PYTHONPATH:
  PYTHONPATH=/home/deploy/workspace/reposkillopt/engine python3 gen_goldens.py

Deterministic, no network. Commit the resulting golden/*.json so the TS port can
assert byte-for-byte parity (contracts/parity-fixtures.md, SC-003).
"""
import dataclasses
import json
import os

from reposkillopt_engine import grounding as G
from reposkillopt_engine import rubric as R
from reposkillopt_engine import proposal as P
from reposkillopt_engine import version as V

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.join(HERE, "repo")
SPEC = open(os.path.join(HERE, "spec.md")).read()


def cit_to_dict(c):
    d = {"raw": c.raw, "path": c.path, "kind": c.kind}
    for k in ("line", "start", "end", "symbol"):
        v = getattr(c, k)
        if v is not None:
            d[k] = v
    return d


# 1) grounding
gr = G.ground_spec(REPO, SPEC)
grounding_golden = {
    "citations": [cit_to_dict(c) for c in gr.citations],
    "resolved": gr.resolved,
    "resolvableTotal": gr.resolvable_total,
    "rate": gr.rate,
    "checks": gr.checks,
    "failures": gr.failures,
}

# 2) rubric: a fixed set of 3 scorecards + baseline -> aggregate + verdict
DIMS, CHECKS = R.DIMENSIONS, R.CHECKS
def card(scorevals, checkvals):
    return R.ScoreCard(scores=dict(zip(DIMS, scorevals)), checks=dict(zip(CHECKS, checkvals)))

# three scorers; mix of agreement / disagreement to exercise majority vs median + low_agreement
s1 = [2, 3, 2, 2, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]
s2 = [2, 1, 2, 2, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]
s3 = [2, 3, 2, 0, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]   # dim3 spread 0..2 (low agreement), dim1 1..3
allpass = [True] * len(CHECKS)
cards = [card(s1, allpass), card(s2, allpass), card(s3, allpass)]
baseline = {d: 2 for d in DIMS}
dims, checks = R.aggregate(cards, baseline)
rr = R.RepoResult(repo="demo", dims=dims, checks=checks)
verdict = R.verdict_for([rr])
rubric_golden = {
    "dims": [dataclasses.asdict(d) for d in dims],
    "checks": checks,
    "verdict": verdict.value,
}

# 3) proposal apply: fixed skill + a set of proposals (successes + errors)
SKILL = "Alpha line.\nBeta line.\nGamma line.\n"
proposal_cases = [
    {"edit_kind": "ADD", "anchor": "Beta line.", "payload": " (added)"},
    {"edit_kind": "ADD", "payload": "Appended.\n"},
    {"edit_kind": "REPLACE", "anchor": "Gamma line.", "payload": "Delta line."},
    {"edit_kind": "DELETE", "anchor": "Alpha line.\n"},
    {"edit_kind": "REPLACE", "anchor": "Missing.", "payload": "x"},   # -> error
    {"edit_kind": "ADD", "anchor": "Beta line.", "payload": " $& literal"},  # $ must stay literal
    {"edit_kind": "NONE"},
]
proposal_golden = []
for case in proposal_cases:
    try:
        prop = P.Proposal.from_dict(case)
        out = prop.apply(SKILL)
        proposal_golden.append({"case": case, "ok": True, "result": out,
                                "eligible": prop.eligible(), "isTerminal": prop.is_terminal})
    except Exception as e:  # noqa: BLE001
        proposal_golden.append({"case": case, "ok": False, "error": type(e).__name__})

# 4) version bumps
version_golden = {
    "0.2.0|minor": V.bump("0.2.0", "minor"),
    "0.2.0|major": V.bump("0.2.0", "major"),
    "1.4.9|patch": V.bump("1.4.9", "patch"),
}

for name, obj in [("grounding", grounding_golden), ("scorecard-aggregate", rubric_golden),
                  ("proposal-apply", proposal_golden), ("version", version_golden)]:
    with open(os.path.join(HERE, "golden", f"{name}.json"), "w") as fh:
        json.dump(obj, fh, indent=2, sort_keys=True)
        fh.write("\n")
print("wrote goldens:", os.listdir(os.path.join(HERE, "golden")))
