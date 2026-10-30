/** Spoken at about 150 words a minute. */
export function readSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length
  return Math.max(5, Math.round((words / 150) * 60))
}
