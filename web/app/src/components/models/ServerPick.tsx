import { useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { Button } from "@troubadour/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@troubadour/ui/popover"
import type { LocalServerInfo } from "./helpers.ts"

/** A server's model count: accent with the number when it answers with some, grey when it's down or has none. */
function ServerBadge({ server }: { server: LocalServerInfo }) {
  const some = server.running && server.models > 0
  return (
    <span
      title={server.running ? `${server.models} ${server.models === 1 ? "model" : "models"}` : "not running"}
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-12 font-medium tabular-nums ${
        some ? "bg-accent-strong text-ink-on-accent" : "bg-elevated text-ink-subtle"
      }`}
    >
      {some ? server.models : server.running ? 0 : "–"}
    </span>
  )
}

const rowClass = (on: boolean) =>
  `flex w-full cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-left hover:bg-elevated ${on ? "bg-elevated font-semibold" : ""}`

/** A pick among the usual local model servers (LM Studio, Ollama, MTPLX, ...), each with its model count.
 * `auto`: an extra first choice ("" = the model server above). */
export function ServerPick({
  label,
  servers,
  value,
  auto,
  onPick,
  selected = value,
}: {
  label: string
  servers: LocalServerInfo[] | undefined
  value?: string
  auto?: string
  onPick: (url: string) => void
  /** The address in use (marked in the list); defaults to `value`. */
  selected?: string
}) {
  const [open, setOpen] = useState(false)
  if (!servers?.length) return null
  const current = servers.find((s) => s.url === value)
  const shown =
    value === undefined
      ? label
      : value === ""
        ? (auto ?? label)
        : current
          ? `${current.name} · ${current.port}`
          : value
  const choose = (url: string) => {
    setOpen(false)
    onPick(url)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button size="sm" aria-label={label} className="w-full justify-between text-12" />}
      >
        <span className="flex min-w-0 items-center gap-2">
          {current && <ServerBadge server={current} />}
          <span className="truncate">{shown}</span>
        </span>
        <ChevronDown className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1">
        <ul aria-label={label} className="text-14">
          {auto !== undefined && (
            <li>
              <button
                type="button"
                aria-current={selected === "" ? "true" : undefined}
                className={rowClass(selected === "")}
                onClick={() => choose("")}
              >
                <span className="w-5" />
                <span className="flex-1">{auto}</span>
                {selected === "" && <Check className="size-3.5" />}
              </button>
            </li>
          )}
          {servers.map((s) => (
            <li key={s.port}>
              <button
                type="button"
                aria-current={s.url === selected ? "true" : undefined}
                className={rowClass(s.url === selected)}
                onClick={() => choose(s.url)}
              >
                <ServerBadge server={s} />
                <span className="flex-1">
                  {s.name} <span className="font-normal text-ink-subtle">· {s.port}</span>
                </span>
                {s.url === selected && <Check className="size-3.5" />}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
