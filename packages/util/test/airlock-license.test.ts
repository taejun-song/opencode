import { describe, expect, test } from "bun:test"
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { AirlockLicense } from "../src/airlock-license.js"

// airlock (feature 009 on 2.x): the engine verifies the same minisign-signed license (Ed25519 over a
// blake2b-512 prehash) as the airlock wrapper. Keys and signatures are generated here in minisign's
// file format so the verifier is exercised exactly as on a customer machine.
function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const pub32 = publicKey.export({ format: "der", type: "spki" }).subarray(-32)
  const keyid = randomBytes(8)
  const pubFile = `untrusted comment: minisign public key\n${Buffer.concat([Buffer.from("Ed"), keyid, pub32]).toString("base64")}\n`
  const signFile = (content: Buffer, trusted = "airlock license") => {
    const sig = sign(null, createHash("blake2b512").update(content).digest(), privateKey)
    const global = sign(null, Buffer.concat([sig, Buffer.from(trusted)]), privateKey)
    return `untrusted comment: signature\n${Buffer.concat([Buffer.from("ED"), keyid, sig]).toString("base64")}\ntrusted comment: ${trusted}\n${global.toString("base64")}\n`
  }
  return { pubFile, signFile }
}
const day = 86_400_000
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10)
const license = (expiry: string) => Buffer.from(`licensee=ACME Corp\ncontract_id=ACME-1\nexpiry=${expiry}\n`)

function setup(opts: { expiry?: string; pub?: string | false; tamper?: boolean; signer?: ReturnType<typeof keypair> } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "al-lic-"))
  const k = keypair()
  if (opts.pub !== false) fs.writeFileSync(path.join(dir, "airlock.pub"), opts.pub ?? k.pubFile)
  if (opts.expiry) {
    const content = license(opts.expiry)
    fs.writeFileSync(path.join(dir, "license.txt"), opts.tamper ? Buffer.concat([content, Buffer.from("x")]) : content)
    fs.writeFileSync(path.join(dir, "license.txt.minisig"), (opts.signer ?? k).signFile(content))
  }
  return { dir, k }
}
const verify = (dir: string, extra: Partial<AirlockLicense.Options> = {}) =>
  AirlockLicense.verify({ dir, now: Date.UTC(2026, 9, 24), warnDays: 14, bakedKeyB64: "", ...extra })

describe("airlock license", () => {
  test("enforcement is off without a public key or with the dev placeholder", () => {
    expect(verify(setup({ pub: false }).dir).state).toBe("off")
    expect(verify(setup({ pub: "untrusted comment: DEV PLACEHOLDER\nxxxx\n" }).dir).state).toBe("off")
  })

  test("a valid license passes with its fields and days left", () => {
    const r = verify(setup({ expiry: "2027-07-30" }).dir)
    expect(r.state).toBe("valid")
    expect(r.contract).toBe("ACME-1")
    expect(r.daysLeft).toBeGreaterThan(14)
  })

  test("inside the warn window the state is warn", () => {
    expect(verify(setup({ expiry: ymd(Date.UTC(2026, 9, 24) + 5 * day) }).dir).state).toBe("warn")
  })

  test("missing, expired, tampered and wrong-key licenses are refused with a clear message", () => {
    const refuse = (dir: string, re: RegExp) => expect(() => verify(dir)).toThrow(re)
    refuse(setup().dir, /no license installed/)
    refuse(setup({ expiry: "2026-10-01" }).dir, /license expired on 2026-10-01 \(ACME Corp/)
    refuse(setup({ expiry: "2027-07-30", tamper: true }).dir, /verification FAILED/)
    refuse(setup({ expiry: "2027-07-30", signer: keypair() }).dir, /different key/)
  })

  test("a baked-in vendor key makes enforcement mandatory and ignores the on-disk key", () => {
    const vendor = keypair()
    const baked = Buffer.from(vendor.pubFile).toString("base64")
    // No disk key and no license: still refused.
    expect(() => verify(setup({ pub: false }).dir, { bakedKeyB64: baked })).toThrow(/no license installed/)
    // A license signed by a disk key the attacker controls is refused; the vendor-signed one passes.
    expect(() => verify(setup({ expiry: "2027-07-30" }).dir, { bakedKeyB64: baked })).toThrow(/different key/)
    const ok = setup({ expiry: "2027-07-30", signer: vendor, pub: "untrusted comment: DEV PLACEHOLDER\n" })
    expect(verify(ok.dir, { bakedKeyB64: baked }).state).toBe("valid")
  })

  test("the CLI gate exempts --version and --help only", () => {
    expect(AirlockLicense.exempt(["--version"])).toBe(true)
    expect(AirlockLicense.exempt(["-h"])).toBe(true)
    expect(AirlockLicense.exempt(["run", "--help"])).toBe(true)
    expect(AirlockLicense.exempt(["run", "hi"])).toBe(false)
    expect(AirlockLicense.exempt(["serve"])).toBe(false)
    expect(AirlockLicense.exempt([])).toBe(false)
  })
})
