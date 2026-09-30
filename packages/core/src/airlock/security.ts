// airlock overlay (feature 012): engine-side pre-send security check.
//
// Every outbound LLM request is submitted to the deployment's security center
// and proceeds only on "allow". The deployment profile is read ONLY from the
// admin-owned managed config (never from the developer's own config), so a
// developer cannot disable the check, repoint the center, or relax the fail
// mode. Contract: specs/012-prompt-security-center/contracts/engine-check.md.
//
// Env:  AIRLOCK_TEST_MANAGED_CONFIG_DIR   honoured only when no real managed profile exists
//       AIRLOCK_SECURITY_SELFTEST=1       one synthetic check, prints the verdict, exits (index.ts)
//       AIRLOCK_SECURITY_SELFTEST_MANAGED_DIR  treat this dir as the REAL managed dir (CI precedence proof)
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Global } from "../global"
import { InstallationVersion } from "../installation/version"
import { SecurityPolicyError, SecurityUnavailableError } from "../v1/session"

export type Profile = {
  center_url: string
  token: string
  fail_mode: "strict" | "permissive"
  timeout_ms: number
}

// Keep in sync with packages/opencode/src/config/managed.ts (which cannot be imported from core).
function systemManagedConfigDir(): string {
  switch (process.platform) {
    case "darwin":
      return "/Library/Application Support/airlock"
    case "win32":
      return path.join(process.env["ProgramData"] || "C:\\ProgramData", "airlock")
    default:
      return "/etc/airlock"
  }
}

function stripJsonc(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1")
}

function readProfileFrom(dir: string): Profile | undefined {
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
    const mode = o["fail_mode"] === "permissive" ? "permissive" : "strict"
    const t = Number(o["timeout_ms"])
    const timeout = Number.isFinite(t) && t > 0 ? Math.min(30000, Math.max(500, Math.floor(t))) : 3000
    return { center_url: url, token, fail_mode: mode, timeout_ms: timeout }
  }
  return undefined
}

let cached: Profile | undefined | null = null
let pendingSync: Promise<void> | undefined

// The real managed dir always wins; the test override applies only when the
// machine has no managed profile at all (CI runners), so it is never a bypass.
export function loadProfile(): Profile | undefined {
  if (cached !== null) return cached
  const realDir = process.env["AIRLOCK_SECURITY_SELFTEST_MANAGED_DIR"] || systemManagedConfigDir()
  let profile = readProfileFrom(realDir)
  if (!profile) {
    const override = process.env["OPENCODE_TEST_MANAGED_CONFIG_DIR"] || process.env["AIRLOCK_TEST_MANAGED_CONFIG_DIR"]
    if (override) profile = readProfileFrom(override)
  }
  cached = profile
  return profile
}

// Identity reuses the applied license (feature 009): no verification here — the
// license gate already ran; this only reads the contract id for attribution.
export function readLicenseFields(): Map<string, string> | undefined {
  const dir = process.env["AIRLOCK_LICENSE_DIR"] ?? path.join(os.homedir(), ".local", "share", "airlock", "license")
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

// Text of the newest message: string content or the text parts of a part array
// (user text, assistant text, tool-result text). Images etc. contribute nothing.
export function newestText(messages: ReadonlyArray<unknown>): string {
  const last = messages[messages.length - 1] as { content?: unknown; parts?: unknown } | undefined
  if (!last) return ""
  const content = last.content ?? last.parts
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  const out: string[] = []
  for (const part of content as Array<Record<string, unknown>>) {
    if (!part || typeof part !== "object") continue
    if (typeof part["text"] === "string") out.push(part["text"])
    else if (part["type"] === "tool-result") {
      const o = part["output"] as Record<string, unknown> | undefined
      if (o && typeof o["value"] === "string") out.push(o["value"])
      else if (typeof part["result"] === "string") out.push(part["result"])
      else if (o && o["value"] !== undefined) out.push(JSON.stringify(o["value"]))
    }
  }
  return out.join("\n")
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")
const excerpt = (s: string) => (s.length > 200 ? s.slice(0, 200) : s)

function journalPath() {
  return path.join(Global.Path.state, "security-journal.jsonl")
}

function journalAppend(entry: Record<string, unknown>) {
  try {
    mkdirSync(Global.Path.state, { recursive: true })
    appendFileSync(journalPath(), JSON.stringify(entry) + "\n")
  } catch {}
}

async function journalSync(profile: Profile) {
  try {
    const file = journalPath()
    if (!existsSync(file)) return
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "")
    if (lines.length === 0) return
    const batch = lines.slice(0, 500)
    const events = batch.map((l) => JSON.parse(l))
    const res = await fetch(`${profile.center_url}/v1/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${profile.token}`,
        "user-agent": `airlock-engine/${InstallationVersion}`,
      },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(profile.timeout_ms),
    })
    if (!res.ok) return
    const body = (await res.json().catch(() => ({}))) as { accepted?: number }
    const accepted = typeof body.accepted === "number" ? Math.min(body.accepted, batch.length) : batch.length
    writeFileSync(file, lines.slice(accepted).map((l) => l + "\n").join(""))
  } catch {}
}

export type CheckInput = {
  sessionID?: string
  model?: string
  agent?: string
  messages: ReadonlyArray<unknown>
}

export type Outcome = "off" | "allow" | "unavailable-permissive"

// Resolves when the request may proceed; throws SecurityPolicyError /
// SecurityUnavailableError otherwise. No-op when no profile is deployed.
export async function securityCheck(input: CheckInput): Promise<void> {
  await securityOutcome(input)
}

export async function securityOutcome(input: CheckInput): Promise<Outcome> {
  const profile = loadProfile()
  if (!profile) return "off"
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
    engine_version: InstallationVersion,
  }
  let res: Response
  try {
    res = await fetch(`${profile.center_url}/v1/check`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${profile.token}`,
        "user-agent": `airlock-engine/${InstallationVersion}`,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(profile.timeout_ms),
    })
  } catch {
    return unavailable(profile, request)
  }
  if (res.status === 401 || res.status === 403) {
    throw new SecurityPolicyError({
      message: `security center rejected this agent's credential (${profile.center_url}); contact your administrator`,
    })
  }
  if (res.status === 413) {
    throw new SecurityPolicyError({ message: "prompt too large for policy check" })
  }
  if (res.status >= 500 || res.status === 404) return unavailable(profile, request)
  let body: { verdict?: string; rule_id?: string; rule_name?: string; message?: string; event_id?: string }
  try {
    body = (await res.json()) as typeof body
  } catch {
    return unavailable(profile, request)
  }
  pendingSync = journalSync(profile)
  if (body.verdict === "allow") return "allow"
  if (body.verdict === "deny") {
    const rule = body.rule_name ?? body.rule_id ?? "policy"
    throw new SecurityPolicyError({
      message: `blocked by organizational policy: ${rule} — ${body.message ?? "prohibited prompt"} (event ${body.event_id ?? "?"})`,
      rule,
      event_id: body.event_id,
    })
  }
  return unavailable(profile, request)
}

function unavailable(profile: Profile, request: Record<string, unknown>): Outcome {
  if (profile.fail_mode === "permissive") {
    const { content, ...rest } = request as { content: string } & Record<string, unknown>
    journalAppend({ ...rest, excerpt: excerpt(content), verdict: "unavailable-permissive", journal_ts: new Date().toISOString() })
    return "unavailable-permissive"
  }
  throw new SecurityUnavailableError({
    message: `security check unavailable (${profile.center_url}); prompts are blocked until the security center is reachable`,
    center_url: profile.center_url,
  })
}

// CI/self-test hook: one synthetic check, verdict on stdout, exit. Never touches a provider.
export async function securitySelftest(): Promise<never> {
  const profile = loadProfile()
  if (!profile) {
    process.stdout.write("security-off\n")
    process.exit(0)
  }
  try {
    const outcome = await securityOutcome({ messages: [{ role: "user", content: "selftest" }] })
    await pendingSync
    process.stdout.write(outcome === "unavailable-permissive" ? "security-unavailable:permissive\n" : "security-allow\n")
    process.exit(0)
  } catch (e) {
    if (SecurityUnavailableError.isInstance(e)) {
      process.stdout.write(`security-unavailable:${profile.fail_mode}\n`)
      process.stderr.write(`[airlock] ${(e as Error).message}\n`)
      process.exit(profile.fail_mode === "strict" ? 1 : 0)
    }
    if (SecurityPolicyError.isInstance(e)) {
      const data = (e as unknown as { data: { rule?: string; message: string } }).data
      process.stdout.write(`security-deny:${data.rule ?? "credential"}\n`)
      process.stderr.write(`[airlock] ${data.message}\n`)
      process.exit(1)
    }
    process.stderr.write(`[airlock] security self-test error: ${String(e)}\n`)
    process.exit(1)
  }
}
