import { Avatar } from "../../components/avatar"
import { Badge } from "../../components/badge"
import { Button } from "../../components/button"
import { Card, CardBody, CardHeader } from "../../components/card"
import { PageHeading } from "../../components/page-heading"
import { SectionLabel } from "../../components/section-label"
import { Spinner } from "../../components/spinner"
import { StatusDot } from "../../components/status-dot"

export const title = "Base"

const variants = ["primary", "secondary", "ghost", "danger", "warning", "link"] as const
const sizes = ["sm", "md", "lg", "xl"] as const
const tones = ["neutral", "accent", "success", "warning", "danger", "info", "legendary"] as const
const dotTones = ["neutral", "accent", "success", "warning", "danger", "info"] as const

export function Section() {
  return (
    <div className="flex flex-col gap-6">
      <SectionLabel>Buttons</SectionLabel>
      {sizes.map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-3">
          {variants.map((variant) => (
            <Button key={variant} variant={variant} size={size}>
              {variant} {size}
            </Button>
          ))}
        </div>
      ))}

      <SectionLabel>Badges</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {tones.map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
      </div>

      <SectionLabel>Status dots</SectionLabel>
      <div className="text-13 text-ink-muted flex flex-wrap items-center gap-3">
        {dotTones.map((tone) => (
          <span key={tone} className="flex items-center gap-1.5">
            <StatusDot tone={tone} /> {tone}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <StatusDot tone="danger" pulse /> pulse
        </span>
      </div>

      <SectionLabel>Avatars</SectionLabel>
      <div className="flex items-center gap-3">
        <Avatar initials="BD" color="var(--color-class-bard)" size={24} />
        <Avatar initials="PL" color="var(--color-class-paladin)" size={30} />
        <Avatar initials="WZ" color="var(--color-class-wizard)" size={36} />
        <Avatar initials="RG" color="var(--color-class-rogue)" size={44} />
      </div>

      <SectionLabel>Spinner</SectionLabel>
      <Spinner />

      <SectionLabel>Card</SectionLabel>
      <Card>
        <CardHeader title="Card title" meta="meta text" action={<Button size="sm">Action</Button>} />
        <CardBody className="text-ink-muted">Card body.</CardBody>
      </Card>

      <SectionLabel>Page heading</SectionLabel>
      <PageHeading
        eyebrow="Eyebrow link"
        title="Page title"
        subtitle="A muted subtitle."
        actions={<Button variant="primary">Do it</Button>}
      />
    </div>
  )
}
