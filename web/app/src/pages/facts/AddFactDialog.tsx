import { useState } from "react"
import { useAddCampaignFact, useAddEntityFact, type Entity } from "@troubadour/api/campaign"
import { Button } from "@troubadour/ui/button"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@troubadour/ui/dialog"
import { Field } from "@troubadour/ui/field"
import { NativeSelect } from "@troubadour/ui/native-select"
import { notify } from "@troubadour/ui/toast"
import { Textarea } from "@troubadour/ui/textarea"
import { CONFIDENCE, type Confidence } from "../../lib/confidence.ts"

const CAMPAIGN = ""

export type AddFactDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  entities: Entity[]
}

/** A fact the GM types in. It goes through the serial campaign write, so two quick adds can't clash. */
export function AddFactDialog({ open, onOpenChange, entities }: AddFactDialogProps) {
  const [text, setText] = useState("")
  const [about, setAbout] = useState(CAMPAIGN)
  const [confidence, setConfidence] = useState<Confidence>("gm")
  const addToEntity = useAddEntityFact()
  const addToCampaign = useAddCampaignFact()
  const body = text.trim()

  const submit = () => {
    if (!body) return
    const done = {
      onSuccess: () => {
        setText("")
        onOpenChange(false)
      },
      onError: (e: Error) => notify(e.message, { tone: "danger" }),
    }
    if (about === CAMPAIGN) addToCampaign.mutate({ text: body, confidence }, done)
    else addToEntity.mutate({ name: about, fact: { text: body, confidence } }, done)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="Add a fact"
          description="Something true that should stay true between sessions."
        />
        <DialogBody className="flex flex-col gap-4">
          <Field label="Fact">
            <Textarea value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="About">
              <NativeSelect value={about} onChange={(e) => setAbout(e.target.value)}>
                <option value={CAMPAIGN}>The campaign</option>
                {entities.map((e) => (
                  <option key={e.name} value={e.name}>
                    {e.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="How sure">
              <NativeSelect value={confidence} onChange={(e) => setConfidence(e.target.value as Confidence)}>
                {Object.entries(CONFIDENCE).map(([id, { label }]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!body} onClick={submit}>
            Add fact
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
