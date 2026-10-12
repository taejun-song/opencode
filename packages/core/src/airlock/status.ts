// airlock status for the TUI status segment (airlock feature 015). Pure filesystem/env reads;
// the license gate already verified the license at startup, so this only summarises it.
// Never returns the security-center token.
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadProfile, readLicenseFields, type Profile } from "./security"

declare const AIRLOCK_LICENSE_PUBKEY_B64: string

export type AirlockStatus = {
  offline: boolean
  license: {
    state: "off" | "ok" | "warn" | "expired"
    licensee?: string
    contract?: string
    daysLeft?: number
  }
  security: { state: "off" | "on"; mode?: "strict" | "permissive"; url?: string }
}

export type StatusDeps = {
  env: Record<string, string | undefined>
  now: number
  enforcing: () => boolean
  license: () => Map<string, string> | undefined
  profile: () => Profile | undefined
}

const WARN_DAYS = 14
const DAY = 86_400_000

// Same decision as the engine license gate: a baked vendor key always enforces; otherwise a
// real (non-placeholder) airlock.pub beside the license enforces.
function enforcing(): boolean {
  const baked = typeof AIRLOCK_LICENSE_PUBKEY_B64 !== "undefined" ? AIRLOCK_LICENSE_PUBKEY_B64 : ""
  if (baked !== "") return true
  const dir = process.env["AIRLOCK_LICENSE_DIR"] ?? path.join(os.homedir(), ".local", "share", "airlock", "license")
  const pub = path.join(dir, "airlock.pub")
  if (!existsSync(pub)) return false
  return !readFileSync(pub, "utf8").includes("DEV PLACEHOLDER")
}

const defaults = (): StatusDeps => ({
  env: process.env,
  now: Date.now(),
  enforcing,
  license: readLicenseFields,
  profile: loadProfile,
})

export function airlockStatus(deps: Partial<StatusDeps> = {}): AirlockStatus {
  const d = { ...defaults(), ...deps }
  const offline = d.env["OPENCODE_OFFLINE"] === "1" || d.env["AIRLOCK_OFFLINE"] === "1"

  let license: AirlockStatus["license"] = { state: "off" }
  if (d.enforcing()) {
    const fields = d.license()
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fields?.get("expiry") ?? "")
    if (fields && m) {
      const end = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59)
      const daysLeft = Math.max(0, Math.ceil((end - d.now) / DAY))
      const state = end < d.now ? "expired" : daysLeft <= WARN_DAYS ? "warn" : "ok"
      license = {
        state,
        licensee: fields.get("licensee") || undefined,
        contract: fields.get("contract_id") || fields.get("contract") || undefined,
        daysLeft,
      }
    } else {
      license = { state: "expired" }
    }
  }

  const p = d.profile()
  const security: AirlockStatus["security"] = p ? { state: "on", mode: p.fail_mode, url: p.center_url } : { state: "off" }
  return { offline, license, security }
}
