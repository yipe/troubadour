// pnpm -C web/app smoke [--port 8770] [--out /tmp/smoke] [--width 1440] [--height 900]
// Visits every route once and reports console errors, page errors and failed requests per route.
// Also reports a route whose page scrolls sideways (scrollWidth past the window).
// Never clicks anything: no Start, no mic test, no audio.
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { collectProblems, launch, parseArgs, resolvePort, VIEWPORT } from "./browser.ts"

const { flags } = parseArgs(process.argv.slice(2))
let port: number
try {
  port = resolvePort(typeof flags.port === "string" ? flags.port : undefined)
} catch (e) {
  console.error(`smoke: ${(e as Error).message}`)
  process.exit(1)
}
const outDir = typeof flags.out === "string" ? flags.out : "/tmp/smoke"
const viewport = {
  width: Number(flags.width ?? VIEWPORT.width),
  height: Number(flags.height ?? VIEWPORT.height),
}
if (!(viewport.width > 0 && viewport.height > 0)) {
  console.error("smoke: --width and --height must be positive numbers")
  process.exit(1)
}
const base = `http://127.0.0.1:${port}`

// Responses a route is expected to produce, as "<status> <path prefix>". Keep each entry justified.
const ALLOW: Record<string, string[]> = {
  // Nothing yet. Add `"<route>": ["404 /api/..."]` with a comment saying why the server answers that way.
}

type Session = { id: string | number }
async function newestSessionId(): Promise<string> {
  const res = await fetch(`${base}/api/sessions`)
  if (!res.ok) throw new Error(`GET /api/sessions -> ${res.status}`)
  const body = (await res.json()) as Session[] | { sessions: Session[] }
  const list = Array.isArray(body) ? body : body.sessions
  // The list is newest-first, as the Sessions page selects its first row.
  const newest = list?.[0]
  if (!newest) throw new Error("GET /api/sessions returned no sessions; seed the scratch server")
  return String(newest.id)
}

let id: string
try {
  id = await newestSessionId()
} catch (e) {
  console.error(`smoke: ${(e as Error).message}`)
  process.exit(1)
}

const routes = [
  "/",
  "/sessions",
  "/sessions/new",
  `/sessions/${id}`,
  `/sessions/${id}/review`,
  `/sessions/${id}/transcript`,
  `/sessions/${id}/recap`,
  "/timeline",
  "/codex",
  "/codex/Captain Orsa Vell",
  "/facts",
  "/ask",
  "/settings/models",
  "/settings/microphone",
  "/settings/players",
  "/settings/vault",
  "/settings/cloud",
  "/welcome/campaign",
]

mkdirSync(outDir, { recursive: true })
const browser = await launch()
const rows: { route: string; ok: boolean; problems: string[] }[] = []
try {
  for (const route of routes) {
    const page = await browser.newPage({ viewport })
    const problems = collectProblems(page, ALLOW[route])
    try {
      await page.goto(base + encodeURI(route), { waitUntil: "networkidle" })
      await page.waitForTimeout(300)
      const slug = route.replace(/^\/|\/$/g, "").replace(/[^A-Za-z0-9]+/g, "-") || "home"
      const overflow = await page.evaluate(() =>
        // The page body is a `main` that scrolls itself, so the window alone never overflows.
        Math.max(
          document.documentElement.scrollWidth - window.innerWidth,
          ...[...document.querySelectorAll("main")].map((m) => m.scrollWidth - m.clientWidth),
        ),
      )
      if (overflow > 0) problems.push(`page scrolls sideways by ${overflow}px at ${viewport.width}px wide`)
      await page.screenshot({ path: join(outDir, `${slug}.png`) })
    } catch (e) {
      problems.push(`navigation: ${(e as Error).message}`)
    }
    rows.push({ route, ok: problems.length === 0, problems: [...problems] })
    await page.close()
  }
} finally {
  await browser.close()
}

const width = Math.max(...rows.map((r) => r.route.length))
for (const r of rows) {
  console.log(
    `${r.ok ? "ok  " : "FAIL"}  ${r.route.padEnd(width)}  ${r.ok ? "" : `${r.problems.length} problem(s)`}`,
  )
  for (const p of r.problems) console.log(`        ${p.slice(0, 200)}`)
}
const failures = rows.filter((r) => !r.ok).length
console.log(`\n${rows.length - failures}/${rows.length} routes clean; screenshots in ${outDir}`)
process.exit(failures ? 1 : 0)
