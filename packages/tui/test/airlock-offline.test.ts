import { describe, expect, test } from "bun:test"
import parsers, { airlockParsers } from "../src/parsers-config"

// airlock: syntax parsers fetched from GitHub on demand are not registered offline (markdown, JS and TS
// use the renderer's built-in parsers) unless AIRLOCK_TUI_REMOTE_PARSERS=1.
describe("airlock offline parsers", () => {
  test("remote parsers are dropped by default and kept on opt-in", () => {
    expect(airlockParsers(parsers.parsers, {})).toEqual([])
    expect(airlockParsers(parsers.parsers, { OPENCODE_TUI_REMOTE_PARSERS: "1" })).toEqual(parsers.parsers)
  })
})
