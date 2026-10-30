export interface LiveTranscriptProps {
  /** Session second to scroll to and highlight (set by a notebook jump). */
  highlightT: number | null
  /** A line was pinned: the page switches the notebook to Pins. */
  onPinned: () => void
}

/** Stub; F5 builds the live transcript. */
export function LiveTranscript(_props: LiveTranscriptProps) {
  return null
}
