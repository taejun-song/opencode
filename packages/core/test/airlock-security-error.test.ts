import { describe, expect } from "bun:test"
import { AIError, SecurityPolicyError, isRetryable } from "@opencode/ai"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/core/provider"
import { SessionSchema } from "@opencode/core/session/schema"
import { SessionRunnerRetry } from "@opencode/core/session/runner/retry"
import { toSessionError } from "@opencode/core/session/to-session-error"
import { Effect } from "effect"
import { it } from "./lib/effect"

// airlock: a prompt the security center blocks (or cannot check, in strict mode) must never be retried:
// not by the provider-error classifier, not by the runner policy, and not by a plugin retry hook.
const deny = new AIError({
  reason: new SecurityPolicyError({
    message: "blocked by organizational policy: no-secrets — Do not paste credentials (event 01ABC)",
    kind: "deny",
    rule: "no-secrets",
    eventId: "01ABC",
  }),
})
const unavailable = new AIError({
  reason: new SecurityPolicyError({
    message: "security check unavailable (http://center:8447)",
    kind: "unavailable",
    centerUrl: "http://center:8447",
  }),
})

describe("airlock security errors", () => {
  it.effect("are never retryable", () =>
    Effect.sync(() => {
      expect(isRetryable(deny)).toBe(false)
      expect(SessionRunnerRetry.isRetryable(unavailable)).toBe(false)
    }),
  )

  it.effect("map to airlock session errors with the details as JSON", () =>
    Effect.sync(() => {
      const e = toSessionError(deny)
      expect(e.type).toBe("airlock.policy")
      expect(e.message).toContain("no-secrets")
      expect(JSON.parse(e.response!.body)).toEqual({ kind: "deny", rule: "no-secrets", event_id: "01ABC" })
      expect(toSessionError(unavailable).type).toBe("airlock.unavailable")
    }),
  )

  it.effect("a plugin retry hook cannot force a retry", () =>
    Effect.gen(function* () {
      const policy = yield* SessionRunnerRetry.policy(SessionSchema.ID.make("ses_airlock"))
      const decision = yield* policy({
        cause: deny,
        error: toSessionError(deny),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ id: Model.ID.make("m"), providerID: Provider.ID.make("p") }),
        hook: (event) => Effect.sync(() => void (event.decision = { retry: true, delay: 0 })),
        retry: true,
      })
      expect(decision.retry).toBe(false)
    }),
  )
})
