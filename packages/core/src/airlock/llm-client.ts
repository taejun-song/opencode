export * as AirlockLLMClient from "./llm-client.js"

// airlock overlay (feature 012, 2.x): the shared model client every core consumer receives (session
// turns, titles, compaction, generate, plugins) runs the security check before any provider I/O.
import type { AIError, LLMRequest } from "@opencode/ai"
import { LLMClient, type LLMClientShape } from "@opencode/ai/route"
import { Effect, Layer, Stream } from "effect"
import { App } from "../app.js"
import { AirlockSecurity } from "./security.js"

type Gate = (request: LLMRequest) => Effect.Effect<unknown, AIError>

export function checkInput(request: LLMRequest, version: string): AirlockSecurity.CheckInput {
  const headers = (request.http as { headers?: Record<string, string> } | undefined)?.headers
  return {
    sessionID: headers?.["x-opencode-session-id"],
    model: `${request.model.provider}/${request.model.id}`,
    messages: request.messages,
    version,
  }
}

export function wrap(base: LLMClientShape, gate: Gate): LLMClientShape {
  const compact = ((request: LLMRequest, options?: never) =>
    gate(request).pipe(Effect.andThen(() => (base.compact as (r: LLMRequest, o?: never) => Effect.Effect<unknown, AIError>)(request, options)))) as unknown as LLMClientShape["compact"]
  return {
    // Lazy: the underlying client is not even invoked until the gate has allowed the request.
    stream: (request, options) => Stream.unwrap(gate(request).pipe(Effect.map(() => base.stream(request, options)))),
    generate: (request, options) => gate(request).pipe(Effect.andThen(() => base.generate(request, options))),
    compact,
  }
}

export const layer = Layer.effect(
  LLMClient.Service,
  Effect.gen(function* () {
    const base = yield* LLMClient.Service
    const app = yield* App.Metadata
    return LLMClient.Service.of(
      wrap(base, (request) =>
        AirlockSecurity.license().pipe(Effect.andThen(AirlockSecurity.check(checkInput(request, app.version)))),
      ),
    )
  }),
).pipe(Layer.provide(LLMClient.layer))
