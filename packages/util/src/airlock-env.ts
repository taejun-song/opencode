// airlock: every AIRLOCK_<NAME> variable aliases the engine's OPENCODE_<NAME> flag (an explicit
// OPENCODE_<NAME> always wins). This module only has side effects and must be evaluated before any
// module reads process.env: it is imported first by both CLI entrypoints and by global-roots.
for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith("AIRLOCK_") || value === undefined) continue
  const target = "OPENCODE_" + key.slice("AIRLOCK_".length)
  if (process.env[target] === undefined) process.env[target] = value
}
export {}
