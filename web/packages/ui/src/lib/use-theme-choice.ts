import { useEffect, useState } from "react"
import { applyTheme, readTheme, saveTheme, watchSystemTheme, type ThemeChoice } from "./theme-choice"

/** The current choice and a setter that stores and applies it at once. */
export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme)
  useEffect(() => watchSystemTheme(() => choice), [choice])
  return [
    choice,
    (next) => {
      saveTheme(next)
      applyTheme(next)
      setChoice(next)
    },
  ]
}
