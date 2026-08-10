// airlock overlay: engine-native time-limited license gate.
//
// The airlock wrapper (bash) gates its commands via license-guard.sh, but the
// engine binary itself was invocable directly — bypassing the time limit. This
// module compiles the same enforcement into the engine: it verifies the SAME
// minisign-signed license (Ed25519, blake2b-512 prehash) against the SAME
// on-disk public key, with the SAME semantics:
//
//   - no pubkey file, or the committed DEV PLACEHOLDER key  -> enforcement OFF
//     (open/dev builds run unlicensed; vendors embed a real key at build time)
//   - valid + inside the warn window                        -> warn, continue
//   - expired / missing / tampered / wrong key              -> fail loud, exit 1
//
// Env:  AIRLOCK_LICENSE_DIR       override the license directory (tests)
//       AIRLOCK_LICENSE_WARN_DAYS warn window in days (default 14)
//       AIRLOCK_LICENSE_SELFTEST  =1: run the gate, print `license-ok`, exit 0
//                                 (deterministic hook for CI self-tests)
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"

const PLACEHOLDER = "DEV PLACEHOLDER"

// Build-time define (script/build.ts): base64 of a minisign public-key FILE.
// Empty in public/dev builds. When a vendor bakes a real key, enforcement is
// MANDATORY: the on-disk pubkey is ignored (deleting/replacing it changes
// nothing) and a missing license blocks instead of running unlicensed.
declare const AIRLOCK_LICENSE_PUBKEY_B64: string
const BAKED_PUBKEY_B64: string = typeof AIRLOCK_LICENSE_PUBKEY_B64 !== "undefined" ? AIRLOCK_LICENSE_PUBKEY_B64 : ""

function licenseDir(): string {
  return process.env["AIRLOCK_LICENSE_DIR"] ?? path.join(homedir(), ".local", "share", "airlock", "license")
}

function b64(line: string): Buffer {
  return Buffer.from(line.trim(), "base64")
}

// minisign public key file: an untrusted-comment line + base64(alg[2] || keyid[8] || key[32]).
function parsePubkey(text: string): { keyid: Buffer; key: Buffer } | null {
  const data = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("untrusted comment:"))
  if (!data) return null
  const raw = b64(data)
  if (raw.length !== 42 || raw.toString("latin1", 0, 2) !== "Ed") return null
  return { keyid: raw.subarray(2, 10), key: raw.subarray(10, 42) }
}

// .minisig: untrusted-comment; base64(alg[2] || keyid[8] || sig[64]);
//           "trusted comment: ..."; base64(globalsig[64] over sig||trusted-comment).
function parseSig(text: string): { alg: string; keyid: Buffer; sig: Buffer; trusted: string; global: Buffer } | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const sigLine = lines.findIndex((l) => l.length > 0 && !l.startsWith("untrusted comment:"))
  if (sigLine < 0) return null
  const trustedLine = lines.slice(sigLine + 1).findIndex((l) => l.startsWith("trusted comment:"))
  if (trustedLine < 0) return null
  const trustedIdx = sigLine + 1 + trustedLine
  const globalLine = lines.slice(trustedIdx + 1).find((l) => l.length > 0)
  if (!globalLine) return null
  const raw = b64(lines[sigLine]!)
  if (raw.length !== 74) return null
  const global = b64(globalLine)
  if (global.length !== 64) return null
  return {
    alg: raw.toString("latin1", 0, 2),
    keyid: raw.subarray(2, 10),
    sig: raw.subarray(10, 74),
    trusted: lines[trustedIdx]!.slice("trusted comment:".length).trim(),
    global,
  }
}

function ed25519Verify(pub32: Buffer, msg: Buffer, sig: Buffer): boolean {
  // Wrap the raw 32-byte key in an SPKI header so node:crypto accepts it.
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pub32])
  const key = createPublicKey({ key: spki, format: "der", type: "spki" })
  return cryptoVerify(null, msg, key, sig)
}

function fail(msg: string, hint?: string): never {
  process.stderr.write(`[airlock] ERROR: ${msg}\n`)
  if (hint) process.stderr.write(`[airlock] ${hint}\n`)
  process.exit(1)
}

// Run the gate. Returns silently when enforcement is off or the license is valid.
export function enforceLicense(): void {
  const dir = licenseDir()
  const pubPath = path.join(dir, "airlock.pub")
  const selftest = process.env["AIRLOCK_LICENSE_SELFTEST"] === "1"
  const pass = (): void => {
    if (selftest) {
      process.stdout.write("license-ok\n")
      process.exit(0)
    }
  }

  // Vendor builds bake the key in: enforcement mandatory, disk pubkey ignored.
  // Otherwise enforcement is opt-in by build: no key / dev placeholder -> off.
  let pubText: string
  if (BAKED_PUBKEY_B64 !== "") {
    pubText = Buffer.from(BAKED_PUBKEY_B64, "base64").toString("utf8")
  } else {
    if (!existsSync(pubPath)) return pass()
    pubText = readFileSync(pubPath, "utf8")
    if (pubText.includes(PLACEHOLDER)) return pass()
  }

  const pub = parsePubkey(pubText)
  if (!pub) fail("license verifier key is unreadable (airlock.pub is not a minisign public key)")

  const licPath = path.join(dir, "license.txt")
  const sigPath = licPath + ".minisig"
  if (!existsSync(licPath) || !existsSync(sigPath)) {
    fail(
      "no license installed — this build enforces a time-limited license",
      "apply your signed key:  airlock license apply <license.txt>",
    )
  }

  const content = readFileSync(licPath)
  const sig = parseSig(readFileSync(sigPath, "utf8"))
  if (!sig) fail("license signature is unreadable (not a minisign signature)")
  if (!sig.keyid.equals(pub.keyid)) fail("license was signed with a different key (key id mismatch)")

  // "ED" = prehashed (blake2b-512 of the file), "Ed" = legacy (raw file).
  let message: Buffer
  if (sig.alg === "ED") message = createHash("blake2b512").update(content).digest()
  else if (sig.alg === "Ed") message = content
  else fail(`unsupported minisign algorithm: ${sig.alg}`)
  if (!ed25519Verify(pub.key, message!, sig.sig)) {
    fail("license verification FAILED (file or signature tampered)", "obtain a new signed license key from your vendor")
  }
  // The global signature binds the trusted comment to the file signature.
  if (!ed25519Verify(pub.key, Buffer.concat([sig.sig, Buffer.from(sig.trusted, "utf8")]), sig.global)) {
    fail("license trusted-comment verification FAILED (signature tampered)")
  }

  const fields = new Map<string, string>()
  for (const line of content.toString("utf8").split(/\r?\n/)) {
    const eq = line.indexOf("=")
    if (eq > 0) fields.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
  }
  const expiry = fields.get("expiry") ?? ""
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry)
  if (!m) fail("license has no valid expiry field (tampered?)")
  const end = Date.UTC(Number(m![1]), Number(m![2]) - 1, Number(m![3]), 23, 59, 59)
  const now = Date.now()
  const who = [fields.get("licensee"), fields.get("contract")].filter(Boolean).join(", ")

  if (now > end) {
    fail(
      `license expired on ${expiry}${who ? ` (${who})` : ""}`,
      "agent commands are disabled. Obtain a new license key and run:  airlock license apply <file>",
    )
  }

  const warnDays = Number(process.env["AIRLOCK_LICENSE_WARN_DAYS"] ?? "14")
  const daysLeft = Math.ceil((end - now) / 86_400_000)
  if (daysLeft <= warnDays) {
    process.stderr.write(`[airlock] WARNING: license expires in ${daysLeft} day(s) (${expiry}) — renew soon\n`)
  }
  return pass()
}
