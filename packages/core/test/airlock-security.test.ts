import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import { AIError } from "@opencode/ai"
import { Effect, Exit, Cause } from "effect"
import { AirlockSecurity } from "../src/airlock/security"
import { ConfigDiscovery } from "../src/config/discovery"

// airlock (feature 012 on 2.x): every outbound model request is checked by the deployment's security
// center before any provider I/O. Contract: airlock specs/012-prompt-security-center/contracts/engine-check.md.

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p))
const writeProfile = (dir: string, sc: Record<string, unknown>) =>
  fs.writeFileSync(path.join(dir, "airlock.json"), JSON.stringify({ security_center: sc }))

type Reply = { status: number; body?: unknown }
let reply: Reply = { status: 200, body: { verdict: "allow" } }
const seen: Array<{ path: string; auth: string | null; body: any }> = []
let server: ReturnType<typeof Bun.serve>
let url = ""

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json().catch(() => null)) as any
      seen.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization"), body })
      if (new URL(req.url).pathname === "/v1/events") return Response.json({ accepted: body?.events?.length ?? 0 })
      return reply.body === undefined ? new Response("", { status: reply.status }) : Response.json(reply.body, { status: reply.status })
    },
  })
  url = server.url.toString().replace(/\/$/, "")
})
afterAll(() => server.stop(true))

const profile = (fail_mode: "strict" | "permissive" = "strict") =>
  ({ center_url: url, token: "tok", fail_mode, timeout_ms: 2000 }) as const
const messages = (text: string) => [{ role: "user", content: [{ type: "text", text }] }]
const run = (eff: Effect.Effect<unknown, AIError>) => Effect.runPromiseExit(eff)
const reasonOf = (exit: Exit.Exit<unknown, AIError>) => {
  if (Exit.isSuccess(exit)) return undefined
  return (Cause.squash(exit.cause) as AIError)?.reason as any
}

describe("managed profile", () => {
  test("reads security_center from airlock.json; ignores incomplete profiles", () => {
    const dir = tmp("al-prof-")
    writeProfile(dir, { center_url: "http://c:8447/", token: "t", fail_mode: "permissive", timeout_ms: 99999 })
    expect(AirlockSecurity.readProfileFrom(dir)).toEqual({
      center_url: "http://c:8447",
      token: "t",
      fail_mode: "permissive",
      timeout_ms: 30000,
    })
    const bad = tmp("al-prof-")
    writeProfile(bad, { center_url: "ftp://x", token: "t" })
    expect(AirlockSecurity.readProfileFrom(bad)).toBeUndefined()
  })

  test("the real managed directory always wins over the test override", () => {
    const real = tmp("al-real-")
    const override = tmp("al-ovr-")
    writeProfile(real, { center_url: "http://real", token: "r" })
    writeProfile(override, { center_url: "http://override", token: "o" })
    expect(AirlockSecurity.loadProfile({ realDir: real, overrideDir: override })?.center_url).toBe("http://real")
    expect(AirlockSecurity.loadProfile({ realDir: tmp("al-empty-"), overrideDir: override })?.center_url).toBe("http://override")
    expect(AirlockSecurity.loadProfile({ realDir: tmp("al-empty-") })).toBeUndefined()
  })

  test("config discovery applies the managed-dir override only when the real directory has no config", () => {
    const real = tmp("al-real-")
    expect(String(ConfigDiscovery.systemDirectory("linux", { OPENCODE_TEST_MANAGED_CONFIG_DIR: "/tmp/m" }, () => false))).toBe(path.resolve("/tmp/m"))
    expect(String(ConfigDiscovery.systemDirectory("linux", { OPENCODE_TEST_MANAGED_CONFIG_DIR: "/tmp/m" }, () => true))).toBe("/etc/airlock")
    void real
  })
})

describe("newest message text", () => {
  test("joins text parts and tool-result values of the newest message only", () => {
    expect(
      AirlockSecurity.newestText([
        { role: "user", content: [{ type: "text", text: "old" }] },
        {
          role: "tool",
          content: [
            { type: "text", text: "a" },
            { type: "tool-result", id: "1", name: "read", result: { type: "text", value: "b" } },
            { type: "tool-result", id: "2", name: "ls", result: { type: "json", value: { f: 1 } } },
            { type: "media", mediaType: "image/png", data: "x" },
          ],
        },
      ]),
    ).toBe('a\nb\n{"f":1}')
    expect(AirlockSecurity.newestText([])).toBe("")
  })
})

describe("check against the security center", () => {
  test("off when no profile is deployed", async () => {
    const exit = await run(AirlockSecurity.check({ messages: messages("hi") }, undefined))
    expect(Exit.isSuccess(exit) && exit.value).toBe("off")
  })

  test("allow proceeds and sends the contract body with the bearer token", async () => {
    reply = { status: 200, body: { verdict: "allow" } }
    seen.length = 0
    const exit = await run(AirlockSecurity.check({ sessionID: "ses_1", model: "intranet/q", messages: messages("hello") }, profile()))
    expect(Exit.isSuccess(exit) && exit.value).toBe("allow")
    const c = seen.find((s) => s.path === "/v1/check")!
    expect(c.auth).toBe("Bearer tok")
    for (const k of ["agent_id", "host", "user", "session_id", "model", "content", "content_sha256", "agent_ts", "engine_version"])
      expect(c.body).toHaveProperty(k)
    expect(c.body.content).toBe("hello")
    expect(c.body.session_id).toBe("ses_1")
  })

  test("deny fails with a non-retryable SecurityPolicy reason carrying rule and event", async () => {
    reply = { status: 200, body: { verdict: "deny", rule_name: "no-secrets", message: "no keys", event_id: "01EV" } }
    const r = reasonOf(await run(AirlockSecurity.check({ messages: messages("api_key=1") }, profile())))
    expect(r._tag).toBe("SecurityPolicy")
    expect(r.kind).toBe("deny")
    expect(r.rule).toBe("no-secrets")
    expect(r.eventId).toBe("01EV")
    expect(r.message).toContain("blocked by organizational policy: no-secrets")
  })

  test("a rejected credential is reported as such", async () => {
    reply = { status: 401 }
    const r = reasonOf(await run(AirlockSecurity.check({ messages: messages("x") }, profile())))
    expect(r.kind).toBe("credential")
    expect(r.message).toContain("rejected this agent's credential")
  })

  test("strict mode blocks when the center is unreachable", async () => {
    reply = { status: 503 }
    const r = reasonOf(await run(AirlockSecurity.check({ messages: messages("x") }, profile("strict"))))
    expect(r.kind).toBe("unavailable")
    expect(r.message).toContain("security check unavailable")
  })

  test("permissive mode proceeds, journals an excerpt (never the full content), and syncs later", async () => {
    const state = tmp("al-state-")
    reply = { status: 503 }
    const long = "z".repeat(500)
    const exit = await run(AirlockSecurity.check({ messages: messages(long) }, profile("permissive"), state))
    expect(Exit.isSuccess(exit) && exit.value).toBe("unavailable-permissive")
    const journal = path.join(state, "security-journal.jsonl")
    const entry = JSON.parse(fs.readFileSync(journal, "utf8").trim())
    expect(entry.verdict).toBe("unavailable-permissive")
    expect(entry.excerpt.length).toBe(200)
    expect(entry).not.toHaveProperty("content")

    reply = { status: 200, body: { verdict: "allow" } }
    seen.length = 0
    await run(AirlockSecurity.check({ messages: messages("again") }, profile("permissive"), state))
    await AirlockSecurity.pendingSync()
    expect(seen.some((s) => s.path === "/v1/events" && s.body.events[0].verdict === "unavailable-permissive")).toBe(true)
    expect(fs.readFileSync(journal, "utf8").trim()).toBe("")
  })
})

describe("license on every model request", () => {
  test("an enforced key with no license fails the request with the license kind", async () => {
    const { generateKeyPairSync, randomBytes } = await import("node:crypto")
    const pub32 = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).subarray(-32)
    const dir = tmp("al-lic-")
    fs.writeFileSync(path.join(dir, "airlock.pub"), `untrusted comment: k\n${Buffer.concat([Buffer.from("Ed"), randomBytes(8), pub32]).toString("base64")}\n`)
    const r = reasonOf(await run(AirlockSecurity.license({ dir, now: Date.now(), warnDays: 14, bakedKeyB64: "" })))
    expect(r._tag).toBe("SecurityPolicy")
    expect(r.kind).toBe("license")
    expect(r.message).toContain("no license installed")
  })
  test("enforcement off (no key) lets requests through", async () => {
    const exit = await run(AirlockSecurity.license({ dir: tmp("al-nolic-"), now: Date.now(), warnDays: 14, bakedKeyB64: "" }))
    expect(Exit.isSuccess(exit)).toBe(true)
  })
})
