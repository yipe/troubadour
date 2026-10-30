import { useState } from "react"
import { Checkbox } from "../../components/checkbox"
import { ColorSwatchPicker } from "../../components/color-swatch-picker"
import { Field } from "../../components/field"
import { Input } from "../../components/input"
import { NativeSelect } from "../../components/native-select"
import { SearchInput } from "../../components/search-input"
import { SectionLabel } from "../../components/section-label"
import { Slider } from "../../components/slider"
import { Switch } from "../../components/switch"
import { Textarea } from "../../components/textarea"

export const title = "Forms"

export function Section() {
  const [query, setQuery] = useState("dragon")
  const [color, setColor] = useState<string | null>("#805AD5")
  const [auto, setAuto] = useState<string | null>(null)
  return (
    <div className="flex max-w-xl flex-col gap-6">
      <SectionLabel>Input</SectionLabel>
      <div className="flex flex-col gap-3">
        <Input placeholder="Default" />
        <Input defaultValue="With a value" />
        <Input disabled defaultValue="Disabled" />
        <Input aria-invalid defaultValue="Invalid" />
      </div>

      <SectionLabel>Textarea</SectionLabel>
      <Textarea placeholder="Notes" />

      <SectionLabel>Search</SectionLabel>
      <SearchInput placeholder="Search" />
      <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} onClear={() => setQuery("")} />

      <SectionLabel>Select</SectionLabel>
      <NativeSelect defaultValue="b">
        <option value="a">Alpha</option>
        <option value="b">Bravo</option>
      </NativeSelect>
      <NativeSelect leading={<span className="bg-class-bard size-2.5 rounded-full" />} defaultValue="bard">
        <option value="bard">Bard</option>
      </NativeSelect>
      <NativeSelect disabled>
        <option>Disabled</option>
      </NativeSelect>

      <SectionLabel>Switch</SectionLabel>
      <div className="flex items-center gap-4">
        <Switch aria-label="Off" />
        <Switch aria-label="On" defaultChecked />
        <Switch aria-label="Disabled" disabled />
      </div>

      <SectionLabel>Checkbox</SectionLabel>
      <div className="flex items-center gap-4">
        <Checkbox aria-label="Unchecked" />
        <Checkbox aria-label="Checked" defaultChecked />
        <Checkbox aria-label="Disabled" disabled />
      </div>

      <SectionLabel>Slider</SectionLabel>
      <Slider defaultValue={40} aria-label="Slider" />

      <SectionLabel>Field</SectionLabel>
      <Field label="Name" hint="Shown on the transcript.">
        <Input />
      </Field>
      <Field label="Name" error="A name is required.">
        <Input />
      </Field>

      <SectionLabel>Colour swatch picker</SectionLabel>
      <div className="flex items-center gap-4">
        <ColorSwatchPicker value={color} onChange={setColor} />
        <ColorSwatchPicker value={auto} onChange={setAuto} allowClear />
      </div>
    </div>
  )
}
