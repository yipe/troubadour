import { useState } from "react"
import { Inbox, Mic } from "lucide-react"
import { Button } from "../../components/button"
import { Chip } from "../../components/chip"
import { EmptyState } from "../../components/empty-state"
import { IconTile } from "../../components/icon-tile"
import { NavItem } from "../../components/nav-item"
import { PillGroup } from "../../components/pill-group"
import { Progress } from "../../components/progress"
import { RailLayout } from "../../components/rail-layout"
import { SectionLabel } from "../../components/section-label"
import { SegmentedBar, SegmentedLegend, type Segment } from "../../components/segmented-bar"
import { Table, TD, TH, THead, TR } from "../../components/table"
import { UnderlineTabs } from "../../components/underline-tabs"

export const title = "Layout"

const segments: Segment[] = [
  { value: 50, color: "var(--color-class-bard)", label: "Bard" },
  { value: 30, color: "var(--color-class-paladin)", label: "Paladin" },
  { value: 20, color: "var(--color-class-wizard)", label: "Wizard" },
]

export function Section() {
  const [tab, setTab] = useState("facts")
  const [pill, setPill] = useState("all")
  const [nav, setNav] = useState("a")
  return (
    <div className="flex flex-col gap-6">
      <SectionLabel>Rail layout and nav items</SectionLabel>
      <div className="border-line rounded-card h-56 overflow-hidden border">
        <RailLayout
          railWidth={220}
          aside={<div className="text-13 text-ink-muted p-3">Aside</div>}
          rail={
            <div className="flex flex-col gap-1 p-2">
              <NavItem
                selected={nav === "a"}
                onClick={() => setNav("a")}
                icon={<Mic size={15} />}
                sub="Second line"
                count={4}
              >
                Selected
              </NavItem>
              <NavItem selected={nav === "b"} onClick={() => setNav("b")} dot="warning" count={12}>
                Other item
              </NavItem>
            </div>
          }
        >
          <div className="text-13 text-ink-muted p-3">Main</div>
        </RailLayout>
      </div>

      <SectionLabel>Underline tabs</SectionLabel>
      <UnderlineTabs
        size="nav"
        value={tab}
        onChange={setTab}
        items={[
          { id: "facts", label: "Facts", count: 4 },
          { id: "ask", label: "Ask", dot: true },
          { id: "notes", label: "Notes" },
        ]}
      />

      <SectionLabel>Pills</SectionLabel>
      <PillGroup
        value={pill}
        onChange={setPill}
        items={[
          { id: "all", label: "All", count: 9 },
          { id: "facts", label: "Facts", count: 4 },
          { id: "people", label: "People", count: 5 },
        ]}
      />

      <SectionLabel>Segmented bar</SectionLabel>
      <SegmentedBar segments={segments} />
      <SegmentedLegend segments={segments} />

      <SectionLabel>Chips</SectionLabel>
      <div className="flex flex-wrap gap-2">
        <Chip>Neutral</Chip>
        <Chip tone="accent" onClick={() => {}}>
          Clickable
        </Chip>
        <Chip tone="success" onRemove={() => {}}>
          Removable
        </Chip>
        <Chip dashed onAccept={() => {}} onReject={() => {}}>
          Pending
        </Chip>
      </div>

      <SectionLabel>Table</SectionLabel>
      <Table>
        <THead>
          <TR>
            <TH>Fact</TH>
            <TH>Said by</TH>
          </TR>
        </THead>
        <tbody>
          <TR>
            <TD>First row</TD>
            <TD>Someone</TD>
          </TR>
          <TR>
            <TD>Second row</TD>
            <TD>Someone else</TD>
          </TR>
        </tbody>
      </Table>

      <SectionLabel>Progress</SectionLabel>
      <div className="flex max-w-sm flex-col gap-2">
        <Progress value={0.3} />
        <Progress value={0.6} tone="success" />
        <Progress value={0.9} tone="warning" />
      </div>

      <SectionLabel>Icon tiles</SectionLabel>
      <div className="flex gap-2">
        <IconTile size={28}>
          <Mic size={15} />
        </IconTile>
        <IconTile tone="accent" size={36}>
          <Mic size={18} />
        </IconTile>
      </div>

      <SectionLabel>Empty state</SectionLabel>
      <EmptyState
        icon={<Inbox size={28} />}
        title="Nothing here yet"
        body="Items show up once the session has facts."
        action={<Button size="sm">Add one</Button>}
      />
    </div>
  )
}
