import { Pencil, Trash2, User } from "lucide-react"
import { useState } from "react"
import { Button } from "../../components/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../components/command"
import { ConfirmDialog } from "../../components/confirm-dialog"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "../../components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "../../components/popover"
import { SectionLabel } from "../../components/section-label"
import { notify, Toaster } from "../../components/toast"
import { Tooltip, TooltipProvider } from "../../components/tooltip"

export const title = "Overlays"

export function Section() {
  const [size, setSize] = useState<"md" | "lg" | null>(null)
  const [confirm, setConfirm] = useState<"danger" | "primary" | null>(null)

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-4">
        <SectionLabel>Dialog</SectionLabel>
        <div className="flex gap-3">
          <Button onClick={() => setSize("md")}>Dialog 640</Button>
          <Button onClick={() => setSize("lg")}>Dialog 900</Button>
        </div>
        <Dialog open={size !== null} onOpenChange={(o) => !o && setSize(null)}>
          <DialogContent size={size ?? "md"}>
            <DialogHeader title="Dialog title" description="A short description." icon={<User />} />
            <DialogBody>Body content.</DialogBody>
            <DialogFooter note="A muted note.">
              <Button onClick={() => setSize(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => setSize(null)}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <SectionLabel>Confirm</SectionLabel>
        <div className="flex gap-3">
          <Button variant="danger" onClick={() => setConfirm("danger")}>
            Danger confirm
          </Button>
          <Button variant="primary" onClick={() => setConfirm("primary")}>
            Primary confirm
          </Button>
        </div>
        <ConfirmDialog
          open={confirm !== null}
          onOpenChange={(o) => !o && setConfirm(null)}
          title="Are you sure?"
          body="This waits one second, then closes."
          confirmLabel="Confirm"
          tone={confirm ?? "primary"}
          onConfirm={() => new Promise<void>((r) => setTimeout(r, 1000))}
        />

        <SectionLabel>Popover, tooltip, menu</SectionLabel>
        <div className="flex gap-3">
          <Popover>
            <PopoverTrigger render={<Button />}>Popover</PopoverTrigger>
            <PopoverContent className="w-[380px] p-4">Popover content.</PopoverContent>
          </Popover>
          <Tooltip content="A tooltip">
            <Button>Hover me</Button>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button />}>Menu</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem icon={<Pencil />}>Rename</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Trash2 />} danger>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <SectionLabel>Command</SectionLabel>
        {/* Opened on demand: cmdk needs ResizeObserver, which the gallery smoke test's jsdom lacks. */}
        <Popover>
          <PopoverTrigger render={<Button className="self-start" />}>Entity picker</PopoverTrigger>
          <PopoverContent align="start" className="w-80">
            <Command>
              <CommandInput placeholder="Find an entity" />
              <CommandList>
                <CommandEmpty>No results.</CommandEmpty>
                <CommandGroup heading="People">
                  <CommandItem>Aria</CommandItem>
                  <CommandItem>Borin</CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <SectionLabel>Toasts</SectionLabel>
        <div className="flex gap-3">
          <Button onClick={() => notify("Saved")}>Neutral</Button>
          <Button onClick={() => notify("Dismissed", { undo: () => notify("Restored") })}>With undo</Button>
          <Button onClick={() => notify("Something failed", { tone: "danger" })}>Danger</Button>
        </div>
        <Toaster />
      </div>
    </TooltipProvider>
  )
}
