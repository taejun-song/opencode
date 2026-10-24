export * as AirlockLicense from "./airlock-license.js"

// airlock overlay (feature 009, ported to 2.x): engine-native time-limited license gate.
//
// Verifies the same minisign-signed license (Ed25519 over a blake2b-512 prehash, "ED"; legacy raw "Ed"
// also accepted) against the same public key as the airlock wrapper, with the same semantics:
//   - no public key, or the committed DEV PLACEHOLDER key  -> enforcement off (open/dev builds)
//   - valid, or inside the warn window                     -> pass (warn)
//   - missing / expired / tampered / wrong key             -> refuse
// A vendor build bakes the key in (AIRLOCK_LICENSE_PUBKEY_B64 define): enforcement is then mandatory and
// the on-disk key is ignored. Called at CLI start (every command but --version/--help) and before every
// model request, so a long-running `serve` stops at expiry too.
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { licenseDir } from "./airlock-center.js"

declare const AIRLOCK_LICENSE_PUBKEY_B64: string | undefined
const BAKED = typeof AIRLOCK_LICENSE_PUBKEY_B64 === "string" ? AIRLOCK_LICENSE_PUBKEY_B64 : ""
const PLACEHOLDER = "DEV PLACEHOLDER"

export interface Options {
  readonly dir: string
  readonly now: number
  readonly warnDays: number
  readonly bakedKeyB64: string
}

export interface Result {
  readonly state: "off" | "valid" | "warn"
  readonly licensee?: string
  readonly contract?: string
  readonly expiry?: string
  readonly daysLeft?: number
}

export class LicenseError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = "LicenseError"
  }
}

const b64 = (line: string) => Buffer.from(line.trim(), "base64")

function parsePubkey(text: string) {
  const data = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("untrusted comment:"))
  if (!data) return undefined
  const raw = b64(data)
  if (raw.length !== 42 || raw.toString("latin1", 0, 2) !== "Ed") return undefined
  return { keyid: raw.subarray(2, 10), key: raw.subarray(10, 42) }
}

function parseSig(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const sigLine = lines.findIndex((l) => l.length > 0 && !l.startsWith("untrusted comment:"))
  if (sigLine < 0) return undefined
  const rel = lines.slice(sigLine + 1).findIndex((l) => l.startsWith("trusted comment:"))
  if (rel < 0) return undefined
  const trustedIdx = sigLine + 1 + rel
  const globalLine = lines.slice(trustedIdx + 1).find((l) => l.length > 0)
  if (!globalLine) return undefined
  const raw = b64(lines[sigLine]!)
  const global = b64(globalLine)
  if (raw.length !== 74 || global.length !== 64) return undefined
  return {
    alg: raw.toString("latin1", 0, 2),
    keyid: raw.subarray(2, 10),
    sig: raw.subarray(10, 74),
    trusted: lines[trustedIdx]!.slice("trusted comment:".length).trim(),
    global,
  }
}

function ed25519(pub32: Buffer, msg: Buffer, sig: Buffer) {
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pub32]),
    format: "der",
    type: "spki",
  })
  return cryptoVerify(null, msg, key, sig)
}

/** Verify the installed license. Throws LicenseError when the license must be refused. */
export function verify(opts: Options): Result {
  let pubText: string
  if (opts.bakedKeyB64 !== "") pubText = Buffer.from(opts.bakedKeyB64, "base64").toString("utf8")
  else {
    const pubPath = path.join(opts.dir, "airlock.pub")
    if (!existsSync(pubPath)) return { state: "off" }
    pubText = readFileSync(pubPath, "utf8")
    if (pubText.includes(PLACEHOLDER)) return { state: "off" }
  }
  const pub = parsePubkey(pubText)
  if (!pub) throw new LicenseError("license verifier key is unreadable (airlock.pub is not a minisign public key)")

  const licPath = path.join(opts.dir, "license.txt")
  const sigPath = licPath + ".minisig"
  if (!existsSync(licPath) || !existsSync(sigPath))
    throw new LicenseError(
      "no license installed — this build enforces a time-limited license",
      "apply your signed key:  airlock license apply <license.txt>",
    )
  const content = readFileSync(licPath)
  const sig = parseSig(readFileSync(sigPath, "utf8"))
  if (!sig) throw new LicenseError("license signature is unreadable (not a minisign signature)")
  if (!sig.keyid.equals(pub.keyid)) throw new LicenseError("license was signed with a different key (key id mismatch)")
  const message =
    sig.alg === "ED" ? createHash("blake2b512").update(content).digest() : sig.alg === "Ed" ? content : undefined
  if (!message) throw new LicenseError(`unsupported minisign algorithm: ${sig.alg}`)
  if (!ed25519(pub.key, message, sig.sig))
    throw new LicenseError(
      "license verification FAILED (file or signature tampered)",
      "obtain a new signed license key from your vendor",
    )
  if (!ed25519(pub.key, Buffer.concat([sig.sig, Buffer.from(sig.trusted, "utf8")]), sig.global))
    throw new LicenseError("license trusted-comment verification FAILED (signature tampered)")

  const fields = new Map<string, string>()
  for (const line of content.toString("utf8").split(/\r?\n/)) {
    const eq = line.indexOf("=")
    if (eq > 0) fields.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
  }
  const expiry = fields.get("expiry") ?? ""
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry)
  if (!m) throw new LicenseError("license has no valid expiry field (tampered?)")
  const end = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59)
  const licensee = fields.get("licensee")
  const contract = fields.get("contract_id") ?? fields.get("contract")
  const who = [licensee, contract].filter(Boolean).join(", ")
  if (opts.now > end)
    throw new LicenseError(
      `license expired on ${expiry}${who ? ` (${who})` : ""}`,
      "agent commands are disabled. Obtain a new license key and run:  airlock license apply <file>",
    )
  const daysLeft = Math.ceil((end - opts.now) / 86_400_000)
  return { state: daysLeft <= opts.warnDays ? "warn" : "valid", licensee, contract, expiry, daysLeft }
}

/** The deployment's options: license dir (OPENCODE_/AIRLOCK_LICENSE_DIR), warn window, baked key. */
export function defaults(): Options {
  const warn = Number(process.env["OPENCODE_LICENSE_WARN_DAYS"] ?? "14")
  return {
    dir: licenseDir(),
    now: Date.now(),
    warnDays: Number.isFinite(warn) ? warn : 14,
    bakedKeyB64: BAKED,
  }
}

/** --version and --help never need a license (they are how users find out what they have). */
export function exempt(argv: ReadonlyArray<string>) {
  return argv.some((a) => a === "--version" || a === "-v" || a === "--help" || a === "-h")
}
