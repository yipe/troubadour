import { page } from "vitest/browser"

declare const __SHOT__: boolean // set from the SHOT env var in vitest.browser.config.ts

/** `await shot("live-notebook-update")` saves /tmp/troubadour-shots/<name>.png when SHOT=1; else a no-op. */
export async function shot(name: string): Promise<void> {
  if (!__SHOT__) return
  await page.screenshot({ path: `/tmp/troubadour-shots/${name}.png`, save: true })
}
