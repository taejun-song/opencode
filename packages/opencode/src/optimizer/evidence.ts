// Build a bounded, line-numbered evidence pack from a real repository.
// Adapted from reposkillopt_engine/evidence.py, but fs/glob-based (no git/grep/
// find subprocess) so it runs portably inside the engine binary on any target.
// This is LLM *input* (the `content` generate_spec sees), not a deterministic
// scoring gate — so it is faithful-in-spirit rather than byte-parity with Python.

import * as fs from "node:fs"
import * as path from "node:path"

const CODE_EXT = [
  ".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs", ".java", ".rb", ".php",
  ".c", ".cc", ".cpp", ".h", ".hpp", ".kt", ".swift", ".sh", ".scala",
]
const MANIFESTS = [
  "pyproject.toml", "package.json", "go.mod", "Cargo.toml", "pom.xml",
  "requirements.txt", "composer.json", "Gemfile", "build.gradle", "setup.py",
]
const ENTRYPOINT_HINTS = [
  "main.py", "serve.py", "app.py", "cli.py", "__main__.py", "index.ts",
  "index.js", "server.py", "manage.py", "wsgi.py", "asgi.py",
]
const SKIP = ["/node_modules/", "/.git/", "/.venv/", "/vendor/", "/dist/", "/build/", "/.next/"]

export interface EvidencePack {
  repoPath: string
  repoName: string
  text: string
  includedFiles: string[]
  omitted: string[]
  charBudget: number
}

function readTextSafe(p: string): string {
  try {
    return fs.readFileSync(p, "utf-8")
  } catch {
    return ""
  }
}

function lineCount(p: string): number {
  const s = readTextSafe(p)
  if (s === "") return 0
  return (s.match(/\n/g)?.length ?? 0) + (s.endsWith("\n") ? 0 : 1)
}

function numbered(p: string, maxLines: number): string {
  const lines = readTextSafe(p).split("\n")
  // drop a trailing empty element from a final newline (mirror splitlines)
  if (lines.length && lines[lines.length - 1] === "") lines.pop()
  const shown = lines.slice(0, maxLines)
  let body = shown.map((ln, i) => `${i + 1}: ${ln}`).join("\n")
  if (lines.length > maxLines) body += `\n… (${lines.length - maxLines} more lines)`
  return body
}

function walk(repo: string): string[] {
  const out: string[] = []
  const stack = [repo]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      const rel = "/" + path.relative(repo, full)
      if (SKIP.some((s) => (rel + "/").includes(s))) continue
      if (e.isDirectory()) stack.push(full)
      else if (e.isFile()) out.push(path.relative(repo, full))
    }
  }
  return out.sort()
}

function listCodeFiles(files: string[]): string[] {
  return files.filter((f) => CODE_EXT.some((ext) => f.endsWith(ext)) && !SKIP.some((s) => ("/" + f).includes(s)))
}

function selectKeyFiles(repo: string, codeFiles: string[], maxFiles: number): string[] {
  const selected: string[] = []
  for (const f of codeFiles) if (ENTRYPOINT_HINTS.includes(path.basename(f))) selected.push(f)
  const bySize = codeFiles.map((f) => [lineCount(path.join(repo, f)), f] as [number, string])
  bySize.sort((a, b) => b[0] - a[0])
  for (const [, f] of bySize) {
    if (!selected.includes(f)) selected.push(f)
    if (selected.length >= maxFiles) break
  }
  return selected.slice(0, maxFiles)
}

function dirTree(repo: string, files: string[], maxDepth = 3, max = 80): string {
  const dirs = new Set<string>()
  for (const f of files) {
    const parts = f.split(path.sep)
    for (let d = 1; d <= Math.min(maxDepth, parts.length - 1); d++) {
      dirs.add("./" + parts.slice(0, d).join("/"))
    }
  }
  return [...dirs].sort().slice(0, max).join("\n")
}

export function buildEvidencePack(
  repoPath: string,
  opts: { charBudget?: number; maxFiles?: number; maxFileLines?: number } = {},
): EvidencePack {
  const charBudget = opts.charBudget ?? 60_000
  const maxFiles = opts.maxFiles ?? 25
  const maxFileLines = opts.maxFileLines ?? 400
  const repoName = path.basename(path.resolve(repoPath))
  const pack: EvidencePack = { repoPath, repoName, text: "", includedFiles: [], omitted: [], charBudget }
  const parts: string[] = [`REPOSITORY: ${repoName}`]

  for (const r of ["README.md", "README.rst", "README"]) {
    const p = path.join(repoPath, r)
    if (fs.existsSync(p)) {
      parts.push(`=== README (head) ===\n${readTextSafe(p).split("\n").slice(0, 40).join("\n")}`)
      break
    }
  }
  for (const m of MANIFESTS) {
    const p = path.join(repoPath, m)
    if (fs.existsSync(p)) parts.push(`=== ${m} ===\n${readTextSafe(p).split("\n").slice(0, 120).join("\n")}`)
  }

  const allFiles = walk(repoPath)
  parts.push(`=== top-level entries ===\n${[...new Set(allFiles.map((f) => f.split(path.sep)[0]))].sort().slice(0, 60).join("\n")}`)
  parts.push(`=== directory tree (depth 3) ===\n${dirTree(repoPath, allFiles)}`)

  let base = parts.join("\n\n")
  if (base.length > charBudget) {
    base = base.slice(0, Math.max(0, charBudget))
    pack.omitted.push("structural-sections (budget)")
  }
  pack.text = base

  const codeFiles = listCodeFiles(allFiles)
  const keyFiles = selectKeyFiles(repoPath, codeFiles, maxFiles)
  let used = pack.text.length
  for (const f of keyFiles) {
    const block = `\n\n=== FILE ${f} (line-numbered) ===\n${numbered(path.join(repoPath, f), maxFileLines)}`
    if (used + block.length > charBudget) {
      pack.omitted.push(f)
      continue
    }
    pack.text += block
    pack.includedFiles.push(f)
    used += block.length
  }
  return pack
}
