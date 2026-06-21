// Semantic-version bumping. 1:1 port of reposkillopt_engine/version.py.

export function parse(v: string): [number, number, number] {
  const parts = v.trim().split(".")
  if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p))) {
    throw new Error(`not a semver: ${JSON.stringify(v)}`)
  }
  const [a, b, c] = parts.map((p) => parseInt(p, 10))
  return [a, b, c]
}

export function bump(v: string, level: string): string {
  const [a, b, c] = parse(v)
  if (level === "major") return `${a + 1}.0.0`
  if (level === "minor") return `${a}.${b + 1}.0`
  if (level === "patch") return `${a}.${b}.${c + 1}`
  throw new Error(`unknown bump level: ${JSON.stringify(level)}`)
}
