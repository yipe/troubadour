export interface NotebookProps {
  /** Jump the transcript to a session second. */
  onJump: (t: number) => void
  tab: string
  onTabChange: (tab: string) => void
}

/** Stub; F6 builds the notebook. */
export function Notebook(_props: NotebookProps) {
  return null
}
