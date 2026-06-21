// Bounded skill-edit proposals + deterministic application.
// 1:1 port of reposkillopt_engine/proposal.py.

export const EDIT_KINDS = new Set([
  "ADD",
  "REPLACE",
  "DELETE",
  "REORDER",
  "SPECIALIZE",
  "GENERALIZE",
  "NONE",
])

export class ProposalError extends Error {}

export interface ProposalInit {
  edit_kind?: string
  target_section?: string
  anchor?: string
  payload?: string
  expected_effect?: string
  rationale?: string
  scope?: string
  bump_level?: string
  supporting_feedback?: string[]
}

export class Proposal {
  editKind: string
  targetSection: string
  anchor: string
  payload: string
  expectedEffect: string
  rationale: string
  scope: string
  bumpLevel: string
  supportingFeedback: string[]

  constructor(init: {
    editKind: string
    targetSection?: string
    anchor?: string
    payload?: string
    expectedEffect?: string
    rationale?: string
    scope?: string
    bumpLevel?: string
    supportingFeedback?: string[]
  }) {
    this.editKind = init.editKind
    this.targetSection = init.targetSection ?? ""
    this.anchor = init.anchor ?? ""
    this.payload = init.payload ?? ""
    this.expectedEffect = init.expectedEffect ?? ""
    this.rationale = init.rationale ?? ""
    this.scope = init.scope ?? "generic"
    this.bumpLevel = init.bumpLevel ?? "minor"
    this.supportingFeedback = init.supportingFeedback ?? []
  }

  static fromObject(d: ProposalInit): Proposal {
    const kind = String(d.edit_kind ?? "").toUpperCase()
    if (!EDIT_KINDS.has(kind)) {
      throw new ProposalError(`invalid edit_kind: ${JSON.stringify(d.edit_kind)}`)
    }
    return new Proposal({
      editKind: kind,
      targetSection: d.target_section ?? "",
      anchor: d.anchor ?? "",
      payload: d.payload ?? "",
      expectedEffect: d.expected_effect ?? "",
      rationale: d.rationale ?? "",
      scope: d.scope ?? "generic",
      bumpLevel: d.bump_level ?? "minor",
      supportingFeedback: [...(d.supporting_feedback ?? [])],
    })
  }

  get isTerminal(): boolean {
    return this.editKind === "NONE"
  }

  /** Only generic, non-terminal proposals are gate-eligible. */
  eligible(): boolean {
    return !this.isTerminal && this.scope === "generic"
  }

  /** Return new skill text with this edit applied. Throws if the anchor is missing. */
  apply(text: string): string {
    if (this.editKind === "NONE") return text
    // NOTE: Python str.replace(a, b, 1) replaces the FIRST occurrence literally.
    // JS String.replace(string, string) also replaces only the first, BUT a string
    // replacement interprets `$&`/`$1`/etc. — so use a function replacement to keep
    // the payload literal (exact parity).
    if (this.editKind === "ADD") {
      if (this.anchor) {
        if (!text.includes(this.anchor)) throw new ProposalError("ADD anchor not found")
        return text.replace(this.anchor, () => this.anchor + this.payload)
      }
      return text + this.payload
    }
    if (["REPLACE", "SPECIALIZE", "GENERALIZE", "REORDER"].includes(this.editKind)) {
      if (!this.anchor || !text.includes(this.anchor)) {
        throw new ProposalError(`${this.editKind} anchor not found`)
      }
      return text.replace(this.anchor, () => this.payload)
    }
    if (this.editKind === "DELETE") {
      if (!this.anchor || !text.includes(this.anchor)) {
        throw new ProposalError("DELETE anchor not found")
      }
      return text.replace(this.anchor, () => "")
    }
    throw new ProposalError(`unhandled edit_kind: ${this.editKind}`)
  }
}
