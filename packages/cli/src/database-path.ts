import path from "node:path"
import { OPENCODE_CHANNEL } from "./version"

// airlock: airlock.db on the airlock channel (and upstream's shared channels); other channels get a
// channel-suffixed airlock db so builds of different channels never share a database.
export function databasePath(data: string, channel: string = OPENCODE_CHANNEL) {
  const filename =
    process.env.OPENCODE_DB ??
    (["airlock", "latest", "dev", "beta", "next", "prod"].includes(channel) ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "1" ||
    process.env.OPENCODE_DISABLE_CHANNEL_DB === "true"
      ? "airlock.db"
      : `airlock-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
  return filename === ":memory:" ? filename : path.resolve(data, filename)
}
