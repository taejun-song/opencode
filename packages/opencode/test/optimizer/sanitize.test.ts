import { test, expect, describe } from "bun:test"
import { sanitizeModelSpec } from "../../src/optimizer/sanitize"

describe("sanitize", () => {
  test("strips a <think> block", () => {
    expect(sanitizeModelSpec("<think>reasoning…</think>\n# Spec\nbody\n")).toBe("# Spec\nbody\n")
  })
  test("strips an outer markdown fence", () => {
    expect(sanitizeModelSpec("```markdown\n# Spec\nbody\n```")).toBe("# Spec\nbody")
  })
  test("preserves inner fences and a clean spec (idempotent)", () => {
    const clean = "# Spec\n\n```mermaid\ngraph TD\n```\n"
    expect(sanitizeModelSpec(clean)).toBe(clean)
    expect(sanitizeModelSpec(sanitizeModelSpec(clean))).toBe(clean)
  })
  test("trims conversational postamble", () => {
    expect(sanitizeModelSpec("# Spec\nbody\nLet me know if you need anything else!")).toBe("# Spec\nbody")
  })
})
