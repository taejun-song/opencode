// airlock status segment (airlock feature 015): offline · license · policy, from the engine's
// own license/profile state. Short form at <= 80 columns.
import { useTerminalDimensions } from "@opentui/solid"
import { airlockStatus, type AirlockStatus as Status } from "@opencode-ai/core/airlock/status"
import type { Theme } from "../theme"
import { useTheme } from "../context/theme"

type Part = { text: string; fg: keyof Theme; bold?: boolean }

export function statusParts(status: Status, width: number): Part[] {
  const short = width <= 80
  const sep: Part = { text: " · ", fg: "borderActive" }
  const out: Part[] = [{ text: "⛨ ", fg: "secondary", bold: true }]
  const lic = status.license
  const days: Part | undefined =
    lic.state === "off"
      ? undefined
      : {
          text: lic.state === "expired" ? "expired" : `${lic.daysLeft ?? 0}d`,
          fg: lic.state === "ok" ? "success" : lic.state === "warn" ? "warning" : "error",
          bold: lic.state !== "ok",
        }
  const policy: Part[] =
    status.security.state === "on"
      ? [{ text: short ? "" : "policy: ", fg: "textMuted" }, { text: status.security.mode ?? "strict", fg: "primary", bold: true }]
      : [{ text: "policy: off", fg: "textMuted" }]

  if (!short && status.offline) out.push({ text: "offline", fg: "textMuted" }, sep)
  if (lic.state === "off") out.push({ text: short ? "unlicensed" : "license: not enforced", fg: "textMuted" }, sep)
  else {
    if (!short && lic.contract) out.push({ text: lic.contract, fg: "textMuted" }, sep)
    out.push(days!, sep)
  }
  out.push(...policy.filter((p) => p.text !== ""))
  return out
}

export function AirlockStatusView(props: { status: Status; theme: Theme; width: number }) {
  return (
    <text wrapMode="none">
      {statusParts(props.status, props.width).map((p) => (
        <span style={{ fg: p.fg === "borderActive" ? props.theme.border : props.theme[p.fg] as any, bold: p.bold }}>
          {p.text}
        </span>
      ))}
    </text>
  )
}

const cached = airlockStatus()

export function AirlockStatus() {
  const { theme } = useTheme()
  const dims = useTerminalDimensions()
  return <AirlockStatusView status={cached} theme={theme} width={dims().width} />
}
