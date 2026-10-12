// airlock home-screen tagline (airlock feature 015).
import type { Theme } from "../theme"
import { useTheme } from "../context/theme"

export const TAGLINE = "offline · licensed · policy-checked"

export function HomeTagline(props: { theme: Theme }) {
  const parts = TAGLINE.split(" · ")
  return (
    <text>
      {parts.map((part, i) => (
        <>
          <span style={{ fg: props.theme.textMuted }}>{part}</span>
          {i < parts.length - 1 ? <span style={{ fg: props.theme.secondary, bold: true }}>{"  ·  "}</span> : null}
        </>
      ))}
    </text>
  )
}

export function HomeTaglineRow() {
  const { theme } = useTheme()
  return (
    <box flexShrink={0} paddingTop={1} alignItems="center">
      <HomeTagline theme={theme} />
    </box>
  )
}
