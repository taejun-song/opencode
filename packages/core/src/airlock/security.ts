export * as AirlockSecurity from "./security.js"

// airlock overlay (feature 012, 2.x): the engine-side gate. The security-center client and the license
// verifier live in @opencode/util (shared with the CLI self-test); this module turns their verdicts
// into the non-retryable AIError(SecurityPolicy) the session runner understands.
import { AIError, SecurityPolicyError } from "@opencode/ai"
import { AirlockCenter } from "@opencode/util/airlock-center"
import { AirlockLicense } from "@opencode/util/airlock-license"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"

export const { readProfileFrom, loadProfile, newestText, identity, licenseDir, pendingSync } = AirlockCenter
export type Profile = AirlockCenter.Profile
export type CheckInput = AirlockCenter.CheckInput
export type Outcome = AirlockCenter.Outcome

type Failure = AirlockCenter.Denial | { readonly kind: "license"; readonly message: string }
const fail = ({ kind, message, ...rest }: Failure) =>
  Effect.fail(new AIError({ reason: new SecurityPolicyError({ kind, message, ...rest }) }))

/** Succeeds when the request may proceed; fails with a non-retryable AIError(SecurityPolicy). */
export const check = (
  input: CheckInput,
  profile: Profile | undefined = AirlockCenter.loadProfile(),
  stateDir: string = Global.Path.state,
): Effect.Effect<Outcome, AIError> =>
  Effect.promise(() => AirlockCenter.query(input, profile, stateDir)).pipe(
    Effect.flatMap((v) => (v.ok ? Effect.succeed(v.outcome) : fail(v))),
  )

/** The license must still be valid for every model request (a long-running server stops at expiry). */
export const license = (opts?: AirlockLicense.Options): Effect.Effect<void, AIError> =>
  Effect.suspend(() => {
    try {
      AirlockLicense.verify(opts ?? AirlockLicense.defaults())
      return Effect.void
    } catch (e) {
      if (e instanceof AirlockLicense.LicenseError) return fail({ kind: "license", message: e.message })
      return Effect.die(e)
    }
  })
