import "./airlock-env.js"
import os from "os"
import path from "path"

// airlock: the layout is $HOME-relative so the engine and the airlock installer agree on every path.
// XDG_* variables (set by CI runners and some desktops) are honoured only with AIRLOCK_HONOR_XDG=1.
const honorXdg = process.env.OPENCODE_HONOR_XDG === "1"
const home = process.env.OPENCODE_TEST_HOME || os.homedir()
const xdg = (value: string | undefined, rel: string[]) =>
  honorXdg && value ? value : home ? path.join(home, ...rel) : undefined
const data = xdg(process.env.XDG_DATA_HOME, [".local", "share"])
const cache = xdg(process.env.XDG_CACHE_HOME, [".cache"])
const config = xdg(process.env.XDG_CONFIG_HOME, [".config"])
const state = xdg(process.env.XDG_STATE_HOME, [".local", "state"])

/** The base directories that root the engine's global paths. */
export function roots(app: string) {
  return {
    data: path.join(data!, app),
    cache: path.join(cache!, app),
    config: path.join(config!, app),
    state: path.join(state!, app),
    tmp: path.join(os.tmpdir(), app),
  }
}
