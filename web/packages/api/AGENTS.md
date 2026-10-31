# @troubadour/api

The API contract: types, HTTP, WebSocket, live store, TanStack Query hooks, test kit.

- Exports `./<domain>` as `src/<domain>/index.ts`; no barrel across domains.
- `pnpm gen` writes `src/generated/index.ts` (`Schemas`) and runs before every typecheck. Never edit or commit it.
- `pnpm -C packages/api test`, `pnpm -C packages/api typecheck`.
- Campaign writes go through `campaignWrite` (serial). Text offsets are UTF-16.
