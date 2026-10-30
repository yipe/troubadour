// pnpm -C web/app shot <route> <out.png> [--port 8770] [--wait <css selector>] [--full]
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { collectProblems, launch, parseArgs, resolvePort, VIEWPORT } from "./browser.ts"

const { flags, positional } = parseArgs(process.argv.slice(2), ["full"])
const [route, out] = positional
if (!route || !out) {
  console.error("usage: shot <route> <out.png> [--port N] [--wait <css selector>] [--full]")
  process.exit(2)
}

let port: number
try {
  port = resolvePort(typeof flags.port === "string" ? flags.port : undefined)
} catch (e) {
  console.error(`shot: ${(e as Error).message}`)
  process.exit(1)
}

const browser = await launch()
let failed = false
try {
  const page = await browser.newPage({ viewport: VIEWPORT })
  const problems = collectProblems(page)
  await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: "networkidle" })
  if (typeof flags.wait === "string") await page.waitForSelector(flags.wait)
  await page.waitForTimeout(300)
  mkdirSync(dirname(out), { recursive: true })
  await page.screenshot({ path: out, fullPage: flags.full === true })
  for (const p of problems) console.error(p)
  failed = problems.length > 0
} catch (e) {
  console.error(`shot: ${(e as Error).message}`)
  failed = true
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
