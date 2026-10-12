/** @jsxImportSource @opentui/solid */
// airlock visual identity (airlock feature 015). Renders the airlock-specific UI pieces at
// 80x24 and 120x40 and asserts that the airlock identity is present and the upstream
// identity (wordmark text, Zen/Go promotions, opencode.ai links) is absent.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { testRender } from "@opentui/solid"
import { DEFAULT_THEMES, resolveTheme } from "../src/theme"
import { DEFAULT_THEME, isAirlockDefaultTheme } from "../src/theme/default"
import { logo } from "../src/logo"
import { HomeTagline, TAGLINE } from "../src/component/airlock-brand"
import { AirlockStatusView } from "../src/component/airlock-status"
import { PolicyNotice } from "../src/component/policy-notice"
import type { AirlockStatus } from "@opencode-ai/core/airlock/status"

const UPSTREAM = /OpenCode|opencode\.ai|\bZen\b|OpenCode Go/

const status: AirlockStatus = {
  offline: true,
  license: { state: "ok", licensee: "Acme Corp", contract: "ACME-2026-004", daysLeft: 291 },
  security: { state: "on", mode: "strict", url: "http://seccenter.intranet:8447" },
}

const SIZES = [
  { width: 80, height: 24 },
  { width: 120, height: 40 },
] as const

function themeValues(mode: "dark" | "light" = "dark") {
  const json = DEFAULT_THEMES[DEFAULT_THEME]
  if (!json) throw new Error(`default theme ${DEFAULT_THEME} is not registered`)
  return resolveTheme(json, mode)
}

async function frame(width: number, height: number, view: () => any) {
  const app = await testRender(view, { width, height })
  try {
    await app.renderOnce()
    return app.captureCharFrame()
  } finally {
    app.renderer.destroy()
  }
}

describe("airlock default theme", () => {
  test("the default theme is airlock and is registered", () => {
    expect(DEFAULT_THEME).toBe("airlock")
    expect(isAirlockDefaultTheme(DEFAULT_THEME)).toBe(true)
    expect(DEFAULT_THEMES.airlock).toBeDefined()
  })

  test("negative: the upstream default is rejected by the check", () => {
    expect(isAirlockDefaultTheme("opencode")).toBe(false)
  })

  test("airlock resolves in dark and light with distinct background and panel", () => {
    for (const mode of ["dark", "light"] as const) {
      const t = themeValues(mode)
      expect(t.background.toInts()).not.toEqual(t.backgroundPanel.toInts())
      expect(t.primary.toInts()).not.toEqual(t.secondary.toInts())
    }
  })
})

for (const size of SIZES) {
  describe(`airlock screens at ${size.width}x${size.height}`, () => {
    test("home: wordmark rows and tagline", async () => {
      const theme = themeValues()
      const out = await frame(size.width, size.height, () => (
        <box flexDirection="column">
          {logo.left.map((row, i) => (
            <text>{row + logo.right[i]}</text>
          ))}
          <HomeTagline theme={theme} />
        </box>
      ))
      for (let i = 0; i < logo.left.length; i++) expect(out).toContain((logo.left[i] + logo.right[i]).trimEnd())
      expect(out).toContain(TAGLINE.split(" · ")[0])
      expect(out).toContain("policy-checked")
      expect(out).not.toMatch(UPSTREAM)
    })

    test("status segment", async () => {
      const theme = themeValues()
      const out = await frame(size.width, size.height, () => (
        <AirlockStatusView status={status} theme={theme} width={size.width} />
      ))
      expect(out).toContain("⛨")
      expect(out).toContain("291d")
      expect(out).toContain("strict")
      if (size.width > 80) {
        expect(out).toContain("offline")
        expect(out).toContain("ACME-2026-004")
      } else {
        expect(out).not.toContain("ACME-2026-004")
      }
      expect(out).not.toMatch(UPSTREAM)
    })

    test("status segment: honest off states", async () => {
      const theme = themeValues()
      const off: AirlockStatus = { offline: false, license: { state: "off" }, security: { state: "off" } }
      const out = await frame(size.width, size.height, () => (
        <AirlockStatusView status={off} theme={theme} width={120} />
      ))
      expect(out).toContain("license: not enforced")
      expect(out).toContain("policy: off")
    })

    test("policy notice: blocked by policy", async () => {
      const theme = themeValues()
      const error = {
        name: "SecurityPolicyError",
        data: {
          message: "blocked by organizational policy: no-secrets — Do not paste credentials (event 01ABC)",
          rule: "no-secrets",
          event_id: "01ABC",
        },
      }
      const out = await frame(size.width, size.height, () => <PolicyNotice error={error} theme={theme} />)
      expect(out).toContain("blocked by policy")
      expect(out).toContain("no-secrets")
      expect(out).toContain("Do not paste credentials")
      expect(out).toContain("01ABC")
      expect(out).toContain("Nothing was sent to the LLM")
      expect(out).not.toMatch(UPSTREAM)
    })

    test("policy notice: security check unavailable", async () => {
      const theme = themeValues()
      const error = {
        name: "SecurityUnavailableError",
        data: {
          message: "security check unavailable (http://seccenter.intranet:8447); prompts are blocked until the security center is reachable",
          center_url: "http://seccenter.intranet:8447",
        },
      }
      const out = await frame(size.width, size.height, () => <PolicyNotice error={error} theme={theme} />)
      expect(out).toContain("security check unavailable")
      expect(out).toContain("seccenter.intranet:8447")
      expect(out).not.toMatch(UPSTREAM)
    })
  })
}

describe("no upstream promotions in user-visible TUI sources", () => {
  const root = path.join(import.meta.dir, "../src")
  const files = [
    "feature-plugins/home/tips-view.tsx",
    "feature-plugins/sidebar/footer.tsx",
    "routes/session/sidebar.tsx",
    "component/dialog-provider.tsx",
    "component/dialog-retry-action.tsx",
    "component/error-component.tsx",
  ]
  for (const file of files) {
    test(file, () => {
      const src = readFileSync(path.join(root, file), "utf8")
      expect(src).not.toMatch(/OpenCode Zen|OpenCode Go|opencode\.ai\/(zen|go|docs)|<b>Open<\/b>|anomalyco\/opencode\/issues/)
    })
  }
})
