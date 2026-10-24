// airlock overlay (features 009/012, 2.x): runs before any command. The engine binary verifies the
// time-limited license itself, so invoking it directly cannot bypass the airlock wrapper; --version and
// --help stay available. Also hosts the CI self-test hooks (AIRLOCK_LICENSE_SELFTEST,
// AIRLOCK_SECURITY_SELFTEST) the engine release workflow runs against the built binary.
import { AirlockCenter } from "@opencode/util/airlock-center"
import { AirlockLicense } from "@opencode/util/airlock-license"

export async function airlockGate(argv: ReadonlyArray<string>, version: string) {
  if (!AirlockLicense.exempt(argv)) {
    try {
      const r = AirlockLicense.verify(AirlockLicense.defaults())
      if (r.state === "warn")
        process.stderr.write(`[airlock] WARNING: license expires in ${r.daysLeft} day(s) (${r.expiry}) — renew soon\n`)
    } catch (e) {
      if (!(e instanceof AirlockLicense.LicenseError)) throw e
      process.stderr.write(`[airlock] ERROR: ${e.message}\n`)
      if (e.hint) process.stderr.write(`[airlock] ${e.hint}\n`)
      process.exit(1)
    }
  }
  if (process.env.OPENCODE_LICENSE_SELFTEST === "1") {
    process.stdout.write("license-ok\n")
    process.exit(0)
  }
  if (process.env.OPENCODE_SECURITY_SELFTEST === "1") {
    const r = await AirlockCenter.selftest(version)
    process.stdout.write(r.stdout)
    process.stderr.write(r.stderr)
    process.exit(r.code)
  }
}
