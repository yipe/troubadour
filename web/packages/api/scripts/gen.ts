// Builds src/generated/ (git-ignored): the server's OpenAPI schema, the TypeScript types from it, and
// the one file domain code imports. Runs before every typecheck (`pretypecheck`).
import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const outDir = fileURLToPath(new URL("../src/generated/", import.meta.url))
const backend = fileURLToPath(new URL("../../../../backend", import.meta.url))
const schemaJson = `${outDir}openapi.json`
const schemaTypes = `${outDir}schema.d.ts`

function run(cmd: string, args: string[]): void {
  // Windows: pnpm is a .cmd shim, which only a shell finds and runs.
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" })
  if (result.error && "code" in result.error && result.error.code === "ENOENT") {
    console.error(`gen: \`${cmd}\` was not found. Run \`yarn setup\` first.`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`gen: \`${cmd} ${args.join(" ")}\` failed.`)
    process.exit(result.status ?? 1)
  }
}

mkdirSync(outDir, { recursive: true })
run("uv", ["run", "--project", backend, "python", "-m", "troubadour.server.openapi", schemaJson])
run("pnpm", ["exec", "openapi-typescript", schemaJson, "-o", schemaTypes])
writeFileSync(
  `${outDir}index.ts`,
  [
    'export type { components } from "./schema"',
    'export type Schemas = import("./schema").components["schemas"]',
    "",
  ].join("\n"),
)
