import { act, fireEvent, screen } from "@testing-library/react"
import { useEffect, useState } from "react"
import type { CampaignJob, JobLive, JobSnippet } from "@troubadour/api/campaign"
import { keys } from "@troubadour/api/query"
import { campaign, campaignJob } from "@troubadour/api/testing"
import { afterEach, describe, expect, it, vi } from "vitest"
import { renderWithProviders } from "../../test/render.tsx"
import { JobStatus } from "./JobStatus.tsx"
import { useJob } from "./useJob.ts"

afterEach(() => vi.useRealTimers())

/** Renders a panel whose job a test can swap without remounting it (the way a `campaign.job` event does). */
function renderPanel(first: CampaignJob) {
  let set: (j: CampaignJob) => void = () => {}
  function Harness() {
    const [job, setJob] = useState(first)
    useEffect(() => {
      set = setJob
    }, [setJob])
    return <JobStatus variant="panel" job={job} />
  }
  renderWithProviders(<Harness />)
  return (job: CampaignJob) => act(() => set(job))
}

const STEPS = ["Read the whole session", "Write the page", "Save the page"]
function writeup(running: number, live: JobLive | null, extra = {}) {
  return campaignJob({
    id: "w1",
    kind: "writeup",
    title: "s1",
    state: "running",
    done: running,
    total: 3,
    message: "Reading 1637 lines…",
    steps: STEPS.map((label, i) => ({
      label,
      state: i < running ? "done" : i === running ? "running" : "pending",
    })),
    live,
    ...extra,
  })
}

describe("JobStatus inline", () => {
  it("shows the title, a bar and the percent", () => {
    renderWithProviders(
      <JobStatus
        variant="inline"
        job={campaignJob({ id: "a", state: "running", done: 2, total: 5, message: "Reading notes" })}
      />,
    )
    expect(screen.getByText("Reading notes")).toBeInTheDocument()
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40")
    expect(screen.getByText("40%")).toBeInTheDocument()
  })

  it("says it is queued, and shows nothing once done", () => {
    const { rerender } = renderWithProviders(<JobStatus variant="inline" job={campaignJob({ id: "a" })} />)
    expect(screen.getByText("Waiting for another job…")).toBeInTheDocument()
    rerender(<JobStatus variant="inline" job={campaignJob({ id: "a", state: "done" })} />)
    expect(screen.queryByText("Waiting for another job…")).toBeNull()
  })
})

describe("JobStatus panel", () => {
  it("lists each step and the model's live progress", () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000_000_000)
    const started = 1_000_000_000 - 245
    const update = renderPanel(writeup(0, { phase: "reading", tokens: 0, tok_s: 0, started }))
    const list = screen.getByRole("list")
    expect([...list.querySelectorAll("li")].map((li) => li.dataset.state)).toEqual([
      "running",
      "pending",
      "pending",
    ])
    expect(list).toHaveTextContent("Reading… 4 m 05 s")
    act(() => vi.advanceTimersByTime(2000))
    expect(list).toHaveTextContent("Reading… 4 m 07 s")
    expect(screen.queryByRole("progressbar")).toBeNull() // reading: no way to tell how far

    update(writeup(1, { phase: "writing", tokens: 1234, tok_s: 27.5, started: 0, fraction: 0.4 }))
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40")
    expect([...list.querySelectorAll("li")].map((li) => li.dataset.state)).toEqual([
      "done",
      "running",
      "pending",
    ])
    expect(list).toHaveTextContent("Writing · 1,234 tokens · 27.5 tok/s")

    update(writeup(1, null))
    expect(list).toHaveTextContent("Reading 1637 lines…") // between calls: the job's message
  })

  it("rotates what the model finds, and fills the wait with stats", () => {
    vi.useFakeTimers()
    const stat = (text: string): JobSnippet => ({ kind: "stat", at: "", text })
    const stats = [stat("2:39:58 of play, 5 at the table"), stat("Natural 20s called out: 5")]
    const show = (snippets: JobSnippet[]) => writeup(0, null, { snippets })
    const update = renderPanel(show(stats))
    const marquee = () => screen.getByTestId("job-marquee")
    expect(marquee()).toHaveTextContent("2:39:58 of play")
    act(() => vi.advanceTimersByTime(12000))
    expect(marquee()).toHaveTextContent("Natural 20s called out: 5")

    update(
      show([
        ...stats,
        { kind: "beat", at: "1:14:26", text: "The turtle swallowed Thoronn." },
        { kind: "person", at: "", text: "Mama: one of three hags." },
      ]),
    )
    act(() => vi.advanceTimersByTime(12000))
    expect(marquee()).toHaveTextContent("Noted · 1:14:26 · The turtle swallowed Thoronn.")
    act(() => vi.advanceTimersByTime(12000))
    expect(marquee()).toHaveTextContent("Met · Mama: one of three hags.")
    act(() => vi.advanceTimersByTime(12000)) // nothing new: back to the stats
    expect(marquee()).toHaveTextContent("2:39:58 of play")
  })

  it("shows the error with its message and dismisses it", () => {
    const onDismiss = vi.fn()
    renderWithProviders(
      <JobStatus
        variant="panel"
        onDismiss={onDismiss}
        job={campaignJob({ id: "a", state: "error", message: "LM Studio is off" })}
      />,
    )
    expect(screen.getByRole("alert")).toHaveTextContent("LM Studio is off")
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
    expect(onDismiss).toHaveBeenCalled()
  })
})

describe("useJob", () => {
  function Probe({ title }: { title?: string }) {
    const { job, active, failed } = useJob("writeup", title)
    return <p>{`${job?.id ?? "none"} active=${active} failed=${failed}`}</p>
  }
  const seeded = (jobs: ReturnType<typeof campaignJob>[]) =>
    [[keys.campaign(), campaign({ jobs })]] as [readonly string[], unknown][]

  it("finds the latest job of a kind and title", () => {
    renderWithProviders(<Probe title="s1" />, {
      queryData: seeded([
        campaignJob({ id: "w1", kind: "writeup", title: "s1", state: "done" }),
        campaignJob({ id: "w2", kind: "writeup", title: "s1", state: "running" }),
        campaignJob({ id: "w3", kind: "writeup", title: "s2", state: "error" }),
        campaignJob({ id: "i1", kind: "improve", title: "s1", state: "error" }),
      ]),
    })
    expect(screen.getByText("w2 active=true failed=false")).toBeInTheDocument()
  })

  it("reports a failure, and none without a match", () => {
    renderWithProviders(<Probe />, {
      queryData: seeded([campaignJob({ id: "w3", kind: "writeup", title: "s2", state: "error" })]),
    })
    expect(screen.getByText("w3 active=false failed=true")).toBeInTheDocument()
  })

  it("is empty when there is no campaign yet", () => {
    renderWithProviders(<Probe />)
    expect(screen.getByText("none active=false failed=false")).toBeInTheDocument()
  })
})
