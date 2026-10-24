import { describe, expect, test } from "bun:test"
import { RipgrepBinary } from "../src/ripgrep/binary"

// airlock: ripgrep ships in the airlock bundle; the engine never downloads it from GitHub unless allowed.
describe("airlock offline ripgrep", () => {
  test("downloading ripgrep needs AIRLOCK_RIPGREP_DOWNLOAD=1", () => {
    expect(RipgrepBinary.downloadAllowed({})).toBe(false)
    expect(RipgrepBinary.downloadAllowed({ OPENCODE_RIPGREP_DOWNLOAD: "1" })).toBe(true)
  })
})
