import { useState } from "react"
import { ExternalLink } from "lucide-react"
import { useLlmConnect, useLlmDisconnect, useLlmKey, type LlmProvider } from "@troubadour/api/llm"
import { Button } from "@troubadour/ui/button"
import { Input } from "@troubadour/ui/input"
import { openSignIn } from "../../lib/signIn.ts"
import { providerBlurb } from "./helpers.ts"

/** Sign in, add a key, or sign out of one hosted provider. Changes apply at once (not on Save). */
export function HostedProvider({
  provider,
  onError,
}: {
  provider: LlmProvider
  onError: (e: string | null) => void
}) {
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const connect = useLlmConnect()
  const saveKey = useLlmKey()
  const disconnect = useLlmDisconnect()
  const chatgpt = provider.id === "openai"

  async function run(work: () => Promise<void>) {
    setBusy(true)
    onError(null)
    setNote(null)
    try {
      await work()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const signIn = (fresh = false) =>
    run(() =>
      openSignIn(async () => (await connect.mutateAsync({ provider: provider.id, fresh })).authorize_url),
    )
  const addKey = () =>
    run(async () => {
      await saveKey.mutateAsync({ provider: provider.id, key })
      setKey("")
    })
  const signOut = () =>
    run(async () => {
      const r = await disconnect.mutateAsync(provider.id)
      if (!r.revoked)
        setNote("ChatGPT didn't confirm the sign-out. You can disconnect Troubadour in ChatGPT's settings.")
    })

  return (
    <div className="flex flex-col gap-2">
      {provider.connected ? (
        <div className="flex items-center gap-2 text-13">
          <span className="min-w-0 flex-1 truncate">
            {chatgpt ? "Using ChatGPT plan" : "Connected"} · {provider.account}
          </span>
          <a
            href={provider.manage_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-12 text-accent underline"
          >
            {chatgpt ? "Manage usage" : "Keys"} <ExternalLink className="size-3" />
          </a>
          <Button size="sm" disabled={busy} onClick={() => void signOut()}>
            {chatgpt ? "Sign out" : "Remove"}
          </Button>
        </div>
      ) : (
        <>
          {provider.sign_in && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={busy} onClick={() => void signIn()}>
                {chatgpt ? "Continue with ChatGPT" : `Sign in with ${provider.label}`}
              </Button>
              {chatgpt && provider.known_account && (
                <button
                  type="button"
                  className="cursor-pointer text-12 text-accent underline"
                  disabled={busy}
                  onClick={() => void signIn(true)}
                >
                  Use another account
                </button>
              )}
            </div>
          )}
          {!chatgpt && (
            <div className="flex gap-2">
              <Input
                type="password"
                aria-label={`${provider.label} key`}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={provider.sign_in ? "Or paste a key" : "Paste your API key"}
                autoComplete="off"
                spellCheck={false}
              />
              <Button disabled={busy || !key.trim()} onClick={() => void addKey()}>
                Add key
              </Button>
            </div>
          )}
        </>
      )}
      <p className="text-12 text-ink-subtle">{providerBlurb(provider)}</p>
      {note && <p className="text-12 text-ink-subtle">{note}</p>}
    </div>
  )
}
