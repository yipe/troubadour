import type { RouteObject } from "react-router"
import { AppLayout } from "./shell/AppLayout.tsx"
import { BareLayout } from "./shell/BareLayout.tsx"
import { LiveGuard } from "./shell/LiveGuard.tsx"
import { NotFound } from "./shell/NotFound.tsx"
import { Redirect } from "./shell/Redirect.tsx"
import { RootGate } from "./shell/RootGate.tsx"
import { RouteError } from "./shell/RouteError.tsx"
import { Waiting } from "./shell/Waiting.tsx"
import { patterns, paths } from "./paths.ts"

/** A page module exports `Component` (React Router's lazy-route convention). */
const page = (load: () => Promise<{ Component: () => React.ReactNode }>): Pick<RouteObject, "lazy"> => ({
  lazy: load,
})

/** Built on each call so tests can flip `import.meta.env.DEV`. */
export function createRoutes(): RouteObject[] {
  const devOnly: RouteObject[] = import.meta.env.DEV
    ? [
        {
          path: patterns.gallery,
          // Not `import("@troubadour/ui/gallery")`: the gallery declares `import.meta.glob` itself, which
          // collides with vite/client in this package's typecheck. Only referenced under DEV, so a
          // production build drops the chunk.
          lazy: async () => {
            const [load] = Object.values(
              import.meta.glob<{ Gallery: () => React.ReactNode }>("../../packages/ui/src/gallery/index.tsx"),
            )
            return { Component: (await load!()).Gallery }
          },
        },
      ]
    : []

  return [
    {
      element: <RootGate />,
      errorElement: <RouteError />,
      HydrateFallback: Waiting,
      children: [
        {
          element: <AppLayout />,
          children: [
            { path: patterns.home, ...page(() => import("./pages/home/index.tsx")) },
            { path: patterns.sessions, ...page(() => import("./pages/sessions/index.tsx")) },
            { path: patterns.ready, ...page(() => import("./pages/ready/index.tsx")) },
            {
              element: <LiveGuard />,
              children: [{ path: patterns.live, ...page(() => import("./pages/live/index.tsx")) }],
            },
            { path: patterns.session, ...page(() => import("./pages/sessions/index.tsx")) },
            { path: patterns.review, ...page(() => import("./pages/review/index.tsx")) },
            { path: patterns.recap, ...page(() => import("./pages/recap/index.tsx")) },
            { path: patterns.timeline, ...page(() => import("./pages/timeline/index.tsx")) },
            { path: patterns.codex, ...page(() => import("./pages/codex/index.tsx")) },
            { path: patterns.codexEntry, ...page(() => import("./pages/codex/index.tsx")) },
            { path: patterns.facts, ...page(() => import("./pages/facts/index.tsx")) },
            { path: patterns.ask, ...page(() => import("./pages/ask/index.tsx")) },
            { path: patterns.settings, ...page(() => import("./pages/settings/index.tsx")) },
            ...devOnly,
            { path: patterns.oldSetup, element: <Redirect to={() => paths.ready()} /> },
            { path: patterns.oldSession, element: <Redirect to={() => paths.live()} /> },
            { path: patterns.oldHistory, element: <Redirect to={() => paths.sessions()} /> },
            { path: patterns.oldHistoryEntry, element: <Redirect to={(p) => paths.session(p.id!)} /> },
            {
              path: patterns.oldTranscript,
              element: (
                <Redirect
                  to={(p, search) => {
                    const t = Number(search.get("t"))
                    return paths.transcript(p.id!, search.has("t") && Number.isFinite(t) ? t : undefined)
                  }}
                />
              ),
            },
            { path: patterns.oldCampaign, element: <Redirect to={() => paths.codex()} /> },
            { path: patterns.oldCampaignEntry, element: <Redirect to={(p) => paths.codex(p.entry!)} /> },
            { path: "*", element: <NotFound /> },
          ],
        },
        {
          element: <BareLayout />,
          children: [{ path: patterns.welcome, ...page(() => import("./pages/welcome/index.tsx")) }],
        },
      ],
    },
  ]
}
