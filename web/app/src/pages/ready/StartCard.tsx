import { useId } from "react"
import { Play } from "lucide-react"
import { Button } from "@troubadour/ui/button"
import { Checkbox } from "@troubadour/ui/checkbox"
import { Field } from "@troubadour/ui/field"
import { Input } from "@troubadour/ui/input"
import { Spinner } from "@troubadour/ui/spinner"
import { Switch } from "@troubadour/ui/switch"

export interface StartChoices {
  title: string
  recordAudio: boolean
  cleanup: boolean
  consent: boolean
}

export type StartCardProps = {
  value: StartChoices
  onChange: (next: StartChoices) => void
  titlePlaceholder: string
  busy: boolean
  /** The server reported an error (no mic, model failed): starting would fail too. */
  blocked: boolean
  onStart: () => void
}

export function StartCard({ value, onChange, titlePlaceholder, busy, blocked, onStart }: StartCardProps) {
  const consentId = useId()
  const set = <K extends keyof StartChoices>(key: K, v: StartChoices[K]) => onChange({ ...value, [key]: v })
  return (
    <section
      aria-label="Start the session"
      className="flex flex-col gap-3.5 rounded-card border border-line bg-surface p-5"
    >
      <h3 className="text-16 font-bold">Start the session</h3>
      <Field label="Working title">
        <Input
          value={value.title}
          maxLength={200}
          placeholder={titlePlaceholder}
          onChange={(e) => set("title", e.target.value)}
        />
      </Field>
      <div className="flex flex-col gap-2.5 text-13">
        <label className="flex items-center gap-2.5">
          <Switch checked={value.recordAudio} onCheckedChange={(on) => set("recordAudio", on)} />
          Keep the audio recording
        </label>
        <label className="flex items-center gap-2.5">
          <Switch checked={value.cleanup} onCheckedChange={(on) => set("cleanup", on)} />
          Fix names as it goes
        </label>
      </div>
      <div className="bg-subtle flex items-start gap-2.5 rounded-control p-3 text-13">
        <Checkbox
          id={consentId}
          className="mt-px size-[18px]"
          checked={value.consent}
          onCheckedChange={(on) => set("consent", on)}
        />
        <label htmlFor={consentId}>Everyone here knows they&rsquo;re being recorded.</label>
      </div>
      <Button
        variant="primary"
        className="h-12 text-16 font-bold"
        disabled={!value.consent || busy || blocked}
        onClick={onStart}
      >
        {busy ? <Spinner /> : <Play className="size-[18px]" aria-hidden />}
        Start session
      </Button>
    </section>
  )
}
