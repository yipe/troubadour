# 0009. Generated API types, gradually

Status: accepted

## Context

About 70 endpoints had hand-written TypeScript types that drifted from the server.

## Decision

FastAPI's OpenAPI schema generates types (`Schemas["X"]` from `pnpm -C web/packages/api gen`, git-ignored, run before every typecheck). New and changed endpoints declare a pydantic `response_model`. The older endpoints keep hand-written types until someone touches them.

## Consequences

New endpoints cannot drift, and no big-bang conversion was needed. Two typing styles coexist for a while.

## Alternatives

Converting every endpoint at once (no behaviour gain), and zod validation of every response (more code, no new safety for a same-machine API).
