/** The chosen mic outlives the page: starting a session leaves it, and a reload starts it fresh. */
export const MIC_KEY = "troubadour.mic"
/** The pre-rename key; read once and moved to MIC_KEY. */
export const OLD_MIC_KEY = "bard.mic"

/** The remembered mic name, or null. Storage can be blocked, so every access is guarded. */
export function readSavedMic(): string | null {
  try {
    const saved = localStorage.getItem(MIC_KEY)
    if (saved !== null) return saved
    const old = localStorage.getItem(OLD_MIC_KEY)
    if (old === null) return null
    localStorage.setItem(MIC_KEY, old)
    localStorage.removeItem(OLD_MIC_KEY)
    return old
  } catch {
    return null
  }
}

/** null (the default mic) forgets the choice. */
export function saveMic(name: string | null) {
  try {
    if (name) localStorage.setItem(MIC_KEY, name)
    else localStorage.removeItem(MIC_KEY)
  } catch {
    // Not remembering the mic is harmless.
  }
}
