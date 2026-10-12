// airlock policy notice (airlock feature 015): how a prompt blocked by the security center,
// or a check that could not be made, is shown in the session.
import type { Theme } from "../theme"

type ErrorLike = { name?: string; data?: Record<string, unknown> } | undefined

export function isPolicyError(error: ErrorLike) {
  return error?.name === "SecurityPolicyError" || error?.name === "SecurityUnavailableError"
}

function guidance(message: string) {
  const i = message.indexOf(" — ")
  const tail = i >= 0 ? message.slice(i + 3) : message
  return tail.replace(/\s*\(event [^)]*\)\s*$/, "")
}

export function PolicyNotice(props: { error: ErrorLike; theme: Theme }) {
  const t = props.theme
  const data = props.error?.data ?? {}
  const message = String(data["message"] ?? "")
  if (props.error?.name === "SecurityUnavailableError") {
    return (
      <box border borderStyle="rounded" borderColor={t.error} backgroundColor={t.backgroundPanel} title=" ⛨ security check unavailable " paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} marginTop={1}>
        <text>
          <span style={{ fg: t.textMuted }}>{"center    "}</span>
          <span style={{ fg: t.text }}>{String(data["center_url"] ?? "")}</span>
        </text>
        <text fg={t.text}>Prompts are blocked until the security center is reachable (strict mode).</text>
      </box>
    )
  }
  const rule = String(data["rule"] ?? "")
  const event = String(data["event_id"] ?? "")
  return (
    <box border borderStyle="rounded" borderColor={t.warning} backgroundColor={t.backgroundPanel} title=" ⛨ blocked by policy " paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} marginTop={1}>
      {rule ? (
        <text>
          <span style={{ fg: t.textMuted }}>{"rule      "}</span>
          <span style={{ fg: t.warning, bold: true }}>{rule}</span>
        </text>
      ) : null}
      <text>
        <span style={{ fg: t.textMuted }}>{"guidance  "}</span>
        <span style={{ fg: t.text }}>{guidance(message)}</span>
      </text>
      {event ? (
        <text>
          <span style={{ fg: t.textMuted }}>{"event     "}</span>
          <span style={{ fg: t.textMuted }}>{event} · recorded by the security center</span>
        </text>
      ) : null}
      <text fg={t.text}> </text>
      <text fg={t.text}>Nothing was sent to the LLM. Rephrase without the restricted content, or contact your administrator.</text>
    </box>
  )
}
