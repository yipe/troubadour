# 0010. Known debt: importing the server builds the engine

Status: accepted

## Context

`troubadour.server.deps` creates the `Engine` and other singletons at import, which reads `DATA_DIR`. Tests patch `deps.*`.

## Decision

The behaviour was kept. Every script that imports the server sets `TROUBADOUR_DATA` first (`troubadour.server.openapi` shows how). The fix is an app factory with lifespan-created dependencies.

## Consequences

Importing the server has side effects, so tooling must set the environment first. The refactor was not mixed into a behaviour-preserving split.

## Alternatives

An app factory now: left as a follow-up.
