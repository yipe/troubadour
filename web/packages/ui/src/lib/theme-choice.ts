export const THEME_CHOICES = ["system", "dark", "light", "midnight"] as const
export type ThemeChoice = (typeof THEME_CHOICES)[number]
export type Theme = Exclude<ThemeChoice, "system">

/** Shared by the app and the cloud website, so a choice made in one browser holds for both. */
export const THEME_KEY = "troubadour.theme"
const LIGHT_QUERY = "(prefers-color-scheme: light)"
const THEMES: Theme[] = ["dark", "light", "midnight"]

function isChoice(value: unknown): value is ThemeChoice {
  return THEME_CHOICES.includes(value as ThemeChoice)
}

/** The stored choice; anything missing, unreadable or unknown is `system`. */
export function readTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return isChoice(stored) ? stored : "system"
  } catch {
    return "system"
  }
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(THEME_KEY, choice)
  } catch {
    // Private window or blocked storage: the choice lasts until the page closes.
  }
}

/** `system` follows the OS: light → light, anything else → dark. */
export function resolveTheme(choice: ThemeChoice, systemIsLight: boolean): Theme {
  if (choice === "system") return systemIsLight ? "light" : "dark"
  return choice
}

function systemIsLight(): boolean {
  return typeof matchMedia === "function" && matchMedia(LIGHT_QUERY).matches
}

export function applyTheme(choice: ThemeChoice): Theme {
  const theme = resolveTheme(choice, systemIsLight())
  document.documentElement.dataset.theme = theme
  return theme
}

/** Keeps `<html data-theme>` in step with the OS while the choice is `system`. Returns a stop function. */
export function watchSystemTheme(getChoice: () => ThemeChoice = readTheme): () => void {
  if (typeof matchMedia !== "function") return () => {}
  const query = matchMedia(LIGHT_QUERY)
  const onChange = () => {
    if (getChoice() === "system") applyTheme("system")
  }
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

/**
 * `applyTheme(readTheme())` as an inline `<script>` for the page's `<head>`, so the first paint is already
 * themed (a module script runs too late and the page flashes dark). Plain ES5: it runs before any bundle.
 */
export const THEME_BOOT_SCRIPT =
  `(function(){var t;try{t=localStorage.getItem(${JSON.stringify(THEME_KEY)})}catch(e){}` +
  `if(${JSON.stringify(THEMES)}.indexOf(t)<0){try{t=matchMedia(${JSON.stringify(LIGHT_QUERY)}).matches?"light":"dark"}catch(e){t="dark"}}` +
  `document.documentElement.dataset.theme=t})()`
