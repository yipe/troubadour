# Web workspace (pnpm: app, ui, api, tokens)

Run from `web/`. `pnpm install` once; `CI=true` needs `--no-frozen-lockfile` the first time. From the repo
root, prefix with `COREPACK_ENABLE_STRICT=0` (the root `package.json` names yarn).

| Task                                                                           | Command                                                  |
| ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Dev server (proxies `/api`, `/ws`, `/auth` to `TROUBADOUR_PORT`, default 8765) | `pnpm dev`                                               |
| Build to `web/dist` (served by the backend)                                    | `pnpm build`                                             |
| All tests, one vitest process, `TZ=UTC`                                        | `pnpm test`                                              |
| Types, lint, format                                                            | `pnpm typecheck`, `pnpm lint`, `pnpm format:check`       |
| One package                                                                    | `pnpm -C packages/<pkg> test` / `typecheck`              |
| Screenshot one route against a scratch server                                  | `pnpm -C app shot <route> /tmp/x.png --port 8790`        |
| Visit every route, report console/page/request errors                          | `pnpm -C app smoke --port 8790` (PNGs in `/tmp/smoke`)   |
| Regenerate API types                                                           | `pnpm -C packages/api gen` (runs before every typecheck) |
| Sync colour tokens from a DPRcalc checkout                                     | `pnpm -C packages/tokens sync` (`$DPR_DIR`)              |

The server for `shot` and `smoke` is `scripts/scratch.sh <port>` at the repo root: a seeded throwaway data
dir, no models, never port 8765. Both tools run headless Chromium with `--mute-audio` and never click.

## Packages

- `app/` `@troubadour/app`: the product.
  - `src/main.tsx`, `App.tsx` (providers), `routes.tsx` (every route; route modules export `Component`),
    `paths.ts` (typed path builders; no string URLs in components).
  - `src/shell/`: top nav, campaign switcher, cloud chip, account menu, recording pill, layouts, route guards.
  - `src/pages/<page>/`: a page, its private components and tests. Pages: `welcome`, `home`, `ready`,
    `live`, `sessions`, `review`, `transcript`, `recap`, `timeline`, `codex`, `facts`, `ask`, `settings`.
  - `src/components/<group>/`: domain components used by two or more pages (ask, audio, cloud, entity,
    facts-table, import-notes, jobs, mic, models, people, players, read-aloud, suggestion, transcript).
  - `src/lib/`: pure domain helpers with unit tests (`players.playerColor`, `confidence`, `sessions`, `format`).
  - `src/test/render.tsx`: `renderWithProviders` (router, query client, live store, audio provider).
- `packages/ui` `@troubadour/ui`: domain-free components, one file per component (`@troubadour/ui/button`),
  `cn` at `@troubadour/ui/cn`, a gallery mounted at `/dev/ui` in dev builds.
- `packages/api` `@troubadour/api`: one folder per domain, imported as `@troubadour/api/<domain>`
  (`players`, `campaigns`, `session`, `sessions`, `campaign`, `ask`, `cloud`, `llm`, `audio`, `clones`,
  `notebook`, `review`, `timeline`, `recap`, `storage`). `query` holds infrastructure only (client, keys,
  `campaignWrite`, WebSocket-to-cache bridge). `live` is the zustand store, `testing` the test kit.
- `packages/tokens` `@yipe/tokens`: `tokens.css` and class/rarity/swatch data, generated from DPRcalc by
  the sync script and committed. Don't edit by hand.

## Rules (oxlint enforces the first four)

- `ui` never imports `@troubadour/api`. No `fetch` in `app/src` or `ui`: server data comes only through a
  `@troubadour/api` hook.
- Pages don't import other pages (`@/pages/*`). Rule of two: code moves to `app/src/components` (or
  `@troubadour/ui` if domain-free) on its second real user.
- Named exports only (config files and route modules' `Component` aside); no barrels.
- Only dependencies already in the lockfile.
- Never edit `packages/api/src/generated/` (git-ignored). New endpoint types are `Schemas["X"]`.
- Campaign writes go through `campaignWrite` (serial: each `mutationFn` reads the latest cached entry and
  writes its response back before returning). Never put server data in zustand; the live-session store
  (`@troubadour/api/live`) is the one exception.
- Styling: Tailwind utilities from the token mapping (`bg-surface`, `text-ink-muted`, `border-line`). No raw
  hex; a player or class colour is passed as a CSS variable. Player colour is `playerColor(player, classes)`
  in `app/src/lib/players.ts`; a null colour is meaningful (use the class colour), never fill it in.
- Dates and numbers format with an explicit `"en-US"` locale. Offsets sent to the server are UTF-16.
- Sign-in popups go through `lib/signIn.openSignIn`.

## Tests

- `renderWithProviders(ui, { route, live, queryData })` plus `mockFetch` and the builders in
  `@troubadour/api/testing`. No network, `TZ=UTC`, no sleeps. Component tests call `cleanup` themselves in
  `ui` (no globals there).
- `*.browser.test.tsx` run in headless Chromium (1440x900, muted); `await shot("name")` writes a PNG under
  `/tmp/troubadour-shots/` when `SHOT=1`. Use them for layout that jsdom cannot judge (virtualized lists,
  popovers). The shot tool cannot open dialogs.
- The query client retries a failed request once, so an error-state test needs a long `findBy` (about 4 s).
- UI work: screenshot the route against the seeded scratch server and compare it with the design PNG in
  `docs/design/troubadour-redesign/screenshots/`; exact values are in the matching `.dc.html`.

## Gotchas

- Base-ui `Button` rendered as a `Link` needs `nativeButton={false}` (and `role="link"` for tests).
- `Command` needs a `ResizeObserver` stub in tests (already in `app/src/test/setup.ts`).
- `useSessionAudio` throws without `SessionAudioProvider`; `renderWithProviders` mounts it.
- `useCampaigns` is cache-only (there is no `GET /api/campaigns`); the snapshot fills it.
- `bridgeSocket(…, { onCampaignSwitch })` is where state tied to the open campaign is cleared.
- `useCloudRestore` takes `{ vaultId, snapshot? }`. `useAsk` takes `{ question, t? }`.
- `/dev/ui` loads the gallery through `import.meta.glob` in `routes.tsx` (a type clash with `vite/client`).
- Live `Session` has no id: the page treats the newest saved session as the current one.
- Rename and merge in the Codex navigate one tick late (`openLater`) because the index redirects to the
  first entry while the cache settles.
