import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { createBrowserRouter } from "react-router"
import { wireLive } from "@troubadour/api/live"
import { bridgeSocket, makeQueryClient } from "@troubadour/api/query"
import { createSocket } from "@troubadour/api/socket"
import { notify } from "@troubadour/ui/toast"
import "./index.css"
import { App } from "./App.tsx"
import { createRoutes } from "./routes.tsx"
import { ErrorBoundary } from "./shell/ErrorBoundary.tsx"
import { applyTheme, readTheme, watchSystemTheme } from "./lib/theme.ts"
import { campaignSwitchTarget } from "./shell/campaignSwitch.ts"

applyTheme(readTheme())
watchSystemTheme()

const socket = createSocket()
const client = makeQueryClient()
const router = createBrowserRouter(createRoutes())

wireLive(socket, { onError: (message) => notify(message, { tone: "danger" }) })
bridgeSocket(socket, client, {
  onCampaignSwitch: () => {
    const to = campaignSwitchTarget(router.state.location.pathname)
    if (to) void router.navigate(to, { replace: true })
  },
})
socket.connect()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App client={client} router={router} />
    </ErrorBoundary>
  </StrictMode>,
)
