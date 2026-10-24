import { describe, expect, test } from "bun:test"
import { AIError, SecurityPolicyError } from "@opencode/ai"
import type { LLMClientShape } from "@opencode/ai/route"
import { Effect, Exit, Stream } from "effect"
import { AirlockLLMClient } from "../src/airlock/llm-client"

// airlock: the shared model client is wrapped so every stream/generate/compact call (session turns,
// titles, compaction, plugins) passes the security check first; a blocked request never reaches it.
const denied = new AIError({ reason: new SecurityPolicyError({ kind: "deny", rule: "r", message: "blocked" }) })

function fakeBase() {
  const calls: string[] = []
  const base = {
    stream: () => (calls.push("stream"), Stream.empty),
    generate: () => (calls.push("generate"), Effect.succeed("response" as never)),
    compact: () => (calls.push("compact"), Effect.succeed("compacted" as never)),
  } as unknown as LLMClientShape
  return { base, calls }
}
const request = {
  model: { provider: "intranet", id: "qwen" },
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  http: { headers: { "x-opencode-session-id": "ses_9" } },
} as never

describe("airlock LLM client wrapper", () => {
  test("a denied request fails before the underlying client is called", async () => {
    const { base, calls } = fakeBase()
    const client = AirlockLLMClient.wrap(base, () => Effect.fail(denied))
    expect(Exit.isFailure(await Effect.runPromiseExit(Stream.runDrain(client.stream(request))))).toBe(true)
    expect(Exit.isFailure(await Effect.runPromiseExit(client.generate(request)))).toBe(true)
    expect(Exit.isFailure(await Effect.runPromiseExit(client.compact(request)))).toBe(true)
    expect(calls).toEqual([])
  })

  test("an allowed request reaches the underlying client", async () => {
    const { base, calls } = fakeBase()
    const client = AirlockLLMClient.wrap(base, () => Effect.succeed("allow"))
    await Effect.runPromise(Stream.runDrain(client.stream(request)))
    await Effect.runPromise(client.generate(request))
    await Effect.runPromise(client.compact(request))
    expect(calls).toEqual(["stream", "generate", "compact"])
  })

  test("the check sees the session id, model and messages of the request", () => {
    expect(AirlockLLMClient.checkInput(request, "2.1.4")).toEqual({
      sessionID: "ses_9",
      model: "intranet/qwen",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      version: "2.1.4",
    })
  })
})

describe("wiring", () => {
  test("the global llmClient node uses the airlock wrapper", async () => {
    const src = await Bun.file(new URL("../src/effect/app-node-platform.ts", import.meta.url)).text()
    expect(src).toMatch(/makeGlobalNode\(\{ service: LLMClient\.Service, layer: AirlockLLMClient\.layer/)
  })
})
