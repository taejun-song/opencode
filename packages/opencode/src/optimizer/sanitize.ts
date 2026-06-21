// Normalize chat-model output quirks. 1:1 port of reposkillopt_engine/sanitize.py.
// Strips a reasoning <think> block, an outer wrapping code fence, and conversational
// pre/postamble; preserves inner fences. Idempotent; no-op on clean specs.

const THINK = /<\s*(think|thinking|reason(?:ing)?)\s*>[\s\S]*?<\s*\/\s*\1\s*>\s*/gi
const FENCE_OPEN = /^(`{3,}|~{3,})\s*(markdown|md)?\s*$/
const FENCE_CLOSE = /^(`{3,}|~{3,})\s*$/
const HEAD = /^(#|---)/
const CITE = /\w+\.\w+:\d/
const CLOSER =
  /\b(let me know|hope this|feel free|if you (?:have|need|'d)|is there anything|happy to|i can also|would you like|let me|here'?s? (?:the|your)|enjoy)\b/i

function stripOuterFence(text: string): string {
  const lines = text.split("\n")
  let i = 0
  while (i < lines.length && lines[i].trim() === "") i++
  if (i >= lines.length) return text
  const m = FENCE_OPEN.exec(lines[i].trim())
  if (!m) return text
  let j = lines.length - 1
  while (j >= 0 && lines[j].trim() === "") j--
  if (j <= i || !FENCE_CLOSE.test(lines[j].trim())) return text
  const inner = lines.slice(i + 1, j)
  if (!m[2]) {
    // bare fence — only strip if it really wraps a spec (inner starts with a heading)
    let k = 0
    while (k < inner.length && inner[k].trim() === "") k++
    if (k >= inner.length || !HEAD.test(inner[k].trim())) return text
  }
  return inner.join("\n")
}

function trimPreamble(text: string): string {
  const lines = text.split("\n")
  for (let idx = 0; idx < lines.length; idx++) {
    if (HEAD.test(lines[idx].trim())) {
      if (idx === 0) return text
      const dropped = lines.slice(0, idx).join("\n")
      if (dropped.includes("[fact]") || CITE.test(dropped)) return text
      return lines.slice(idx).join("\n")
    }
  }
  return text
}

function trimPostamble(text: string): string {
  const lines = text.split("\n")
  let j = lines.length - 1
  let changed = false
  while (j >= 0) {
    const s = lines[j].trim()
    if (s === "") {
      j--
      continue
    }
    if (CLOSER.test(s) && !s.includes("`") && !/^[#|\-*>]/.test(s)) {
      j--
      changed = true
      continue
    }
    break
  }
  return changed ? lines.slice(0, j + 1).join("\n") : text
}

export function sanitizeModelSpec(text: string): string {
  return trimPostamble(trimPreamble(stripOuterFence(text.replace(THINK, ""))))
}
