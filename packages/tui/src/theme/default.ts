// airlock: the default theme. Users who pick another theme keep their choice (kv/config win).
export const DEFAULT_THEME = "airlock"

export function isAirlockDefaultTheme(name: string) {
  return name === "airlock"
}
