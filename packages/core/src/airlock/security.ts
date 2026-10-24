export * as AirlockSecurity from "./security.js"

// airlock overlay (feature 012, ported to 2.x): engine-side pre-send security check.
//
// Every outbound model request is submitted to the deployment's security center and proceeds only on
// "allow". The deployment profile is read ONLY from the admin-owned managed config, so a developer
// cannot disable the check, repoint the center or relax the fail mode. The test override directory is
// honoured only when the machine has no real managed profile (CI), so it is never a bypass.
// Contract: airlock specs/012-prompt-security-center/contracts/engine-check.md.
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { AIError, SecurityPolicyError } from "@opencode/ai"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { ConfigDiscovery } from "../config/discovery.js"

export type Profile = {
  readonly center_url: string
  readonly token: string
  readonly fail_mode: "strict" | "permissive"
  readonly timeout_ms: number
}

const stripJsonc = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1")

export function readProfileFrom(dir: string): Profile | undefined {
  for (const name of ["airlock.json", "airlock.jsonc"]) {
    const file = path.join(dir, name)
    if (!existsSync(file)) continue
    let raw: unknown
    try {
      raw = JSON.parse(stripJsonc(readFileSync(file, "utf8")))
    } catch {
      continue
    }
    const sc = (raw as { security_center?: unknown })?.security_center
    if (!sc || typeof sc !== "object") continue
    const o = sc as Record<string, unknown>
    const url = typeof o["center_url"] === "string" ? o["center_url"].trim().replace(/\/+$/, "") : ""
    const token = typeof o["token"] === "string" ? o["token"] : ""
    if (!/^https?:\/\//.test(url) || token === "") continue
    const t = Number(o["timeout_ms"])
    return {
      center_url: url,
      token,
      fail_mode: o["fail_mode"] === "permissive" ? "permissive" : "strict",
      timeout_ms: Number.isFinite(t) && t > 0 ? Math.min(30000, Math.max(500, Math.floor(t))) : 3000,
    }
  }
  return undefined
}

let cached: Profile | undefined | null = null

/** The real managed directory always wins; the override applies only when it holds no profile. */
export function loadProfile(dirs?: { realDir?: string; overrideDir?: string }): Profile | undefined {
  if (!dirs && cached !== null) return cached
  const realDir =
    dirs?.realDir ??
    process.env["OPENCODE_SECURITY_SELFTEST_MANAGED_DIR"] ??
    ConfigDiscovery.systemDirectory(process.platform, process.env, () => true)
  const overrideDir = dirs ? dirs.overrideDir : process.env["OPENCODE_TEST_MANAGED_CONFIG_DIR"]
  const profile = readProfileFrom(realDir) ?? (overrideDir ? readProfileFrom(overrideDir) : undefined)
  if (!dirs) cached = profile
  return profile
}

export function licenseDir() {
  return process.env["OPENCODE_LICENSE_DIR"] ?? path.join(Global.Path.data, "license")
}

/** Contract id from the applied license (verified by the license gate; read here for attribution only). */
export function readLicenseFields(dir = licenseDir()): Map<string, string> | undefined {
  const file = path.join(dir, "license.txt")
  if (!existsSync(file)) return undefined
  const fields = new Map<string, string>()
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const eq = line.indexOf("=")
    if (eq > 0) fields.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
  }
  return fields
}

export function identity() {
  const fields = readLicenseFields()
  const contract = fields?.get("contract_id") || fields?.get("contract") || ""
  const host = os.hostname() || "host"
  let user = "user"
  try {
    user = os.userInfo().username || "user"
  } catch {}
  return { contract_id: contract || null, host, user, agent_id: `${contract || "unlicensed"}@${host}/${user}` }
}

type PartLike = { readonly type?: unknown; readonly text?: unknown; readonly result?: unknown }
type MessageLike = { readonly content?: unknown }

/** Text of the newest message: text parts and tool-result values. Media contributes nothing. */
export function newestText(messages: ReadonlyArray<unknown>): string {
  const last = messages[messages.length - 1] as MessageLike | undefined
  if (!last) return ""
  const content = last.content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  const out: string[] = []
  for (const part of content as ReadonlyArray<PartLike>) {
    if (!part || typeof part !== "object") continue
    if (part.type === "text" && typeof part.text === "string") out.push(part.text)
    else if (part.type === "tool-result") {
      const r = part.result as { value?: unknown } | undefined
      if (r && typeof r.value === "string") out.push(r.value)
      else if (r && r.value !== undefined) out.push(JSON.stringify(r.value))
    }
  }
  return out.join("\n")
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")
const excerpt = (s: string) => (s.length > 200 ? s.slice(0, 200) : s)
const journalPath = (stateDir: string) => path.join(stateDir, "security-journal.jsonl")

function journalAppend(stateDir: string, entry: Record<string, unknown>) {
  try {
    mkdirSync(stateDir, { recursive: true })
    appendFileSync(journalPath(stateDir), JSON.stringify(entry) + "\n")
  } catch {}
}

let sync: Promise<void> = Promise.resolve()
/** Settles once the last journal upload attempt finished (tests and the self-test await it). */
export const pendingSync = () => sync

async function journalSync(profile: Profile, stateDir: string, version: string) {
  try {
    const file = journalPath(stateDir)
    if (!existsSync(file)) return
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "")
    if (lines.length === 0) return
    const batch = lines.slice(0, 500)
    const res = await fetch(`${profile.center_url}/v1/events`, {
      method: "POST",
      headers: headers(profile, version),
      body: JSON.stringify({ events: batch.map((l) => JSON.parse(l)) }),
      signal: AbortSignal.timeout(profile.timeout_ms),
    })
    if (!res.ok) return
    const body = (await res.json().catch(() => ({}))) as { accepted?: number }
    const accepted = typeof body.accepted === "number" ? Math.min(body.accepted, batch.length) : batch.length
    writeFileSync(file, lines.slice(accepted).map((l) => l + "\n").join(""))
  } catch {}
}

const headers = (profile: Profile, version: string) => ({
  "content-type": "application/json",
  authorization: `Bearer ${profile.token}`,
  "user-agent": `airlock-engine/${version}`,
})

export type CheckInput = {
  readonly sessionID?: string
  readonly model?: string
  readonly messages: ReadonlyArray<unknown>
  readonly version?: string
}

export type Outcome = "off" | "allow" | "unavailable-permissive"

const fail = (fields: ConstructorParameters<typeof SecurityPolicyError>[0]) =>
  Effect.fail(new AIError({ reason: new SecurityPolicyError(fields) }))

type Verdict =
  | { readonly kind: "status"; readonly status: number; readonly body?: Record<string, unknown> }
  | { readonly kind: "unreachable" }

async function ask(profile: Profile, request: Record<string, unknown>, version: string): Promise<Verdict> {
  try {
    const res = await fetch(`${profile.center_url}/v1/check`, {
      method: "POST",
      headers: headers(profile, version),
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(profile.timeout_ms),
    })
    const body = res.ok ? ((await res.json().catch(() => undefined)) as Record<string, unknown> | undefined) : undefined
    return { kind: "status", status: res.status, body }
  } catch {
    return { kind: "unreachable" }
  }
}

/**
 * Succeeds with the outcome when the request may proceed; fails with a non-retryable
 * `AIError(SecurityPolicy)` otherwise. `profile` defaults to the deployed managed profile.
 */
export const check = (
  input: CheckInput,
  profile: Profile | undefined = loadProfile(),
  stateDir: string = Global.Path.state,
): Effect.Effect<Outcome, AIError> =>
  Effect.gen(function* () {
    if (!profile) return "off" as const
    const version = input.version ?? "unknown"
    const who = identity()
    const content = newestText(input.messages)
    const request = {
      agent_id: who.agent_id,
      contract_id: who.contract_id,
      host: who.host,
      user: who.user,
      session_id: input.sessionID ?? null,
      model: input.model ?? null,
      content,
      content_sha256: sha256(content),
      agent_ts: new Date().toISOString(),
      engine_version: version,
    }
    const unavailable = () => {
      if (profile.fail_mode === "permissive") {
        const { content: full, ...rest } = request
        journalAppend(stateDir, {
          ...rest,
          excerpt: excerpt(full),
          verdict: "unavailable-permissive",
          journal_ts: new Date().toISOString(),
        })
        return Effect.succeed("unavailable-permissive" as const)
      }
      return fail({
        kind: "unavailable",
        centerUrl: profile.center_url,
        message: `security check unavailable (${profile.center_url}); prompts are blocked until the security center is reachable`,
      })
    }
    const verdict = yield* Effect.promise(() => ask(profile, request, version))
    if (verdict.kind === "unreachable") return yield* unavailable()
    const { status, body } = verdict
    if (status === 401 || status === 403)
      return yield* fail({
        kind: "credential",
        centerUrl: profile.center_url,
        message: `security center rejected this agent's credential (${profile.center_url}); contact your administrator`,
      })
    if (status === 413) return yield* fail({ kind: "too-large", message: "prompt too large for policy check" })
    if (status >= 500 || status === 404 || !body) return yield* unavailable()
    sync = journalSync(profile, stateDir, version)
    if (body["verdict"] === "allow") return "allow" as const
    if (body["verdict"] === "deny") {
      const rule = String(body["rule_name"] ?? body["rule_id"] ?? "policy")
      const eventId = typeof body["event_id"] === "string" ? body["event_id"] : undefined
      return yield* fail({
        kind: "deny",
        rule,
        eventId,
        message: `blocked by organizational policy: ${rule} — ${String(body["message"] ?? "prohibited prompt")} (event ${eventId ?? "?"})`,
      })
    }
    return yield* unavailable()
  })
