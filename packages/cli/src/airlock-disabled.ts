// airlock overlay (2.x): features that need the internet, or that airlock does not ship, fail with a
// clear message instead of attempting the network. Fails through the CLI's normal error path (no
// process.exit), so in-process callers and tests are unaffected.
import { Effect } from "effect"

export class AirlockUnavailableError extends Error {
  constructor(what: string, hint: string) {
    super(`[airlock] ${what} is not available in airlock (offline, bundle-installed engine).\n[airlock] ${hint}`)
    this.name = "AirlockUnavailableError"
  }
}

export const airlockUnavailable = (what: string, hint: string) => Effect.fail(new AirlockUnavailableError(what, hint))
