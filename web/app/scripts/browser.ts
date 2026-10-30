// Shared by shot.ts and smoke.ts. Both drive headless Chromium, always muted, against a scratch server.
import { chromium, type Browser, type Page } from "playwright"

export const VIEWPORT = { width: 1440, height: 900 } // the design's canvas

// Port 8765 is the real app: a game may be running and the data dir holds the user's recordings.
export function resolvePort(flag: string | undefined): number {
  const port = Number(flag ?? process.env.PORT ?? 8767)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`bad port: ${flag ?? process.env.PORT}`)
  }
  if (port === 8765) throw new Error("port 8765 is the real app; use a scratch server (scripts/scratch.sh)")
  return port
}

export async function launch(): Promise<Browser> {
  return chromium.launch({ headless: true, args: ["--mute-audio"] })
}

export type PageProblems = string[]

// Console errors, uncaught page errors, failed requests and HTTP >= 400 responses. `allow` is a list of
// "<status> <path>" prefixes a route is expected to produce.
export function collectProblems(page: Page, allow: string[] = []): PageProblems {
  const problems: PageProblems = []
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`)
  })
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`))
  page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ""}`))
  page.on("response", (r) => {
    if (r.status() < 400) return
    const key = `${r.status()} ${new URL(r.url()).pathname}`
    if (allow.some((a) => key.startsWith(a))) return
    problems.push(`http: ${key}`)
  })
  return problems
}

// Minimal flag parser: `--name value` pairs and bare `--name` booleans, the rest are positionals.
export function parseArgs(argv: string[], booleans: string[] = []) {
  const flags: Record<string, string | true> = {}
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? ""
    if (!a.startsWith("--")) positional.push(a)
    else if (booleans.includes(a.slice(2))) flags[a.slice(2)] = true
    else flags[a.slice(2)] = argv[++i] ?? ""
  }
  return { flags, positional }
}
