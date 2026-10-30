// Stub. B6 replaces it with openapi-typescript output from the server's OpenAPI schema.
import { mkdirSync, writeFileSync } from "node:fs"

const out = new URL("../src/generated/", import.meta.url)
mkdirSync(out, { recursive: true })
writeFileSync(new URL("index.ts", out), "export type Schemas = Record<string, never>\n")
