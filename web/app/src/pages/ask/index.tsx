import { useState } from "react"
import { X } from "lucide-react"
import { useAsk, useDeleteAnswer, type AnswerSource, type CampaignAnswer } from "@troubadour/api/ask"
import { useCampaign } from "@troubadour/api/campaign"
import { Button } from "@troubadour/ui/button"
import { NavItem } from "@troubadour/ui/nav-item"
import { PageHeading } from "@troubadour/ui/page-heading"
import { RailLayout } from "@troubadour/ui/rail-layout"
import { Spinner } from "@troubadour/ui/spinner"
import { Textarea } from "@troubadour/ui/textarea"
import { notify } from "@troubadour/ui/toast"
import { AskAnswer } from "../../components/ask/AskAnswer.tsx"
import { obsidianUrl } from "../../lib/entities.ts"

const MAX_QUESTION = 500

function dotFor(answer: CampaignAnswer) {
  if (answer.state === "error") return "danger"
  if (answer.state === "done") return answer.found ? "success" : "neutral"
  return "accent"
}

export function Component() {
  const campaign = useCampaign()
  const ask = useAsk()
  const remove = useDeleteAnswer()
  const [question, setQuestion] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (!campaign.data) return <Spinner />
  const { answers, obsidian } = campaign.data
  const newestFirst = [...answers].sort((a, b) => b.created - a.created)
  const current = newestFirst.find((a) => a.id === selectedId) ?? newestFirst[0]

  function send(text: string) {
    const q = text.trim()
    if (!q || ask.isPending) return
    ask.mutate(
      { question: q },
      {
        onSuccess: (answer) => {
          setSelectedId(answer.id)
          setQuestion("")
        },
      },
    )
  }

  function deleteQuestion(answer: CampaignAnswer) {
    if (answer.id === current?.id) {
      // Land on the next newest, not back on the first row.
      const i = newestFirst.indexOf(answer)
      setSelectedId((newestFirst[i + 1] ?? newestFirst[i - 1])?.id ?? null)
    }
    remove.mutate(answer.id, {
      onSuccess: () => notify("Question deleted"),
      onError: (e) => notify(e.message, { tone: "danger" }),
    })
  }

  function openSource(source: AnswerSource) {
    // Transcript lines are played by the row itself; entries are links. Only notes open in Obsidian.
    if (source.kind === "transcript" || !source.path || !obsidian) return
    window.open(obsidianUrl(obsidian, source.path), "_self")
  }

  return (
    <RailLayout
      railWidth={340}
      rail={
        <div className="flex flex-col gap-4 p-4">
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              send(question)
            }}
          >
            <Textarea
              aria-label="Ask about the campaign"
              rows={3}
              maxLength={MAX_QUESTION}
              value={question}
              placeholder="Who did we suspect has the diamond?"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  send(question)
                }
              }}
            />
            <Button type="submit" disabled={!question.trim() || ask.isPending}>
              Ask
            </Button>
            {ask.isError ? (
              <p role="alert" className="text-12 text-danger">
                {ask.error.message}
              </p>
            ) : null}
            <p className="text-12 text-ink-subtle">
              Answers come from your transcripts and notes, on this Mac. They aren't saved as facts.
            </p>
          </form>
          <nav aria-label="Past questions" className="flex flex-col gap-0.5">
            {newestFirst.length === 0 ? (
              <p className="px-3 text-14 text-ink-subtle">No questions yet.</p>
            ) : (
              newestFirst.map((a) => (
                <div key={a.id} className="group relative">
                  <NavItem
                    selected={a.id === current?.id}
                    dot={dotFor(a)}
                    onClick={() => setSelectedId(a.id)}
                    className="pr-9"
                  >
                    {a.question}
                  </NavItem>
                  <button
                    type="button"
                    aria-label={`Delete \u201C${a.question}\u201D`}
                    onClick={() => deleteQuestion(a)}
                    className="absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-control text-ink-subtle opacity-0 group-hover:opacity-100 hover:bg-elevated hover:text-ink focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </div>
              ))
            )}
          </nav>
        </div>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-10">
        {current ? (
          <>
            <PageHeading title={current.question} />
            <AskAnswer
              key={current.id}
              answer={current}
              onSource={openSource}
              retry={
                <Button
                  variant="secondary"
                  className="self-start"
                  disabled={ask.isPending}
                  onClick={() => send(current.question)}
                >
                  Try again
                </Button>
              }
            />
          </>
        ) : (
          <PageHeading
            title="Ask"
            subtitle="Ask anything about the campaign and the answer cites its sources."
          />
        )}
      </div>
    </RailLayout>
  )
}
