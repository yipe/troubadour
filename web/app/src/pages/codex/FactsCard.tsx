import { useState, type FormEvent } from "react"
import { useAddEntityFact, type Entity } from "@troubadour/api/campaign"
import { Card, CardHeader } from "@troubadour/ui/card"
import { Input } from "@troubadour/ui/input"
import { FactsTable } from "../../components/facts-table/FactsTable.tsx"

export function FactsCard({ entity }: { entity: Entity }) {
  const [text, setText] = useState("")
  const add = useAddEntityFact()

  function submit(e: FormEvent) {
    e.preventDefault()
    const fact = text.trim()
    if (!fact) return
    add.mutate({ name: entity.name, fact: { text: fact } })
    setText("")
  }

  return (
    <Card>
      <CardHeader
        title="Facts"
        meta={entity.facts.length}
        action={<span className="text-12 text-ink-subtle">Things still true next session</span>}
      />
      <div className="p-2">
        <FactsTable
          rows={entity.facts.map((fact) => ({ fact }))}
          showAbout={false}
          emptyText="No facts yet."
          addSlot={
            <form onSubmit={submit} className="px-2 pb-1">
              <Input
                aria-label="Add a fact"
                placeholder="Add a fact, e.g. Owes Pip 20 gold"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              {add.isError ? (
                <p role="alert" className="mt-1 text-12 text-danger">
                  Couldn’t save that fact. Try again.
                </p>
              ) : null}
            </form>
          }
        />
      </div>
    </Card>
  )
}
