import { expect, it } from "vitest"
import { campaignJob } from "@troubadour/api/testing"
import { notesStatus } from "./notesStatus.ts"

const read = { id: "a", ingested: true }
const unread = { id: "a", ingested: false }

it("is read once no job has the session and it was ingested", () => {
  expect(notesStatus(read, [])).toEqual({ state: "read" })
})

it("is unread when no job has it and it was never ingested", () => {
  expect(notesStatus(unread, [])).toEqual({ state: "unread" })
  const done = campaignJob({ id: "j", kind: "import", state: "error", sessions: ["a"] })
  expect(notesStatus(unread, [done])).toEqual({ state: "unread" }) // a failed job isn't working on it
})

it("is queued while its job waits, or while the job reads sessions listed before it", () => {
  const waiting = campaignJob({ id: "j", kind: "import", state: "queued", sessions: ["a"] })
  expect(notesStatus(unread, [waiting])).toEqual({ state: "queued" })
  const later = campaignJob({ id: "j", kind: "import", state: "running", sessions: ["b", "a"] })
  expect(notesStatus(unread, [later])).toEqual({ state: "queued" })
})

it("is reading when its job is running and it is the first session listed", () => {
  const job = campaignJob({ id: "j", kind: "import", state: "running", sessions: ["a", "b"] })
  expect(notesStatus(unread, [job])).toEqual({ state: "reading", job })
})

it("ignores jobs of other kinds", () => {
  const other = campaignJob({ id: "j", kind: "writeup", state: "running", sessions: ["a"] })
  expect(notesStatus(read, [other])).toEqual({ state: "read" })
})
