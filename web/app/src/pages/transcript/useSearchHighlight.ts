import { useEffect, type RefObject } from "react"

export const HIGHLIGHT_NAME = "transcript-search"

/**
 * Marks every match of `query` inside `container` with the CSS Custom Highlight API, so the rows keep
 * their React-owned DOM (nothing is wrapped or remounted). The list is virtualised, so rows that scroll
 * in are re-marked by a mutation observer. A browser without the API simply shows no marks.
 */
export function useSearchHighlight(container: RefObject<HTMLElement | null>, query: string) {
  useEffect(() => {
    const root = container.current
    const highlights = typeof CSS !== "undefined" ? CSS.highlights : undefined
    const q = query.trim().toLocaleLowerCase("en-US")
    if (!root || !highlights || !q) {
      highlights?.delete(HIGHLIGHT_NAME)
      return
    }
    let frame = 0
    const mark = () => {
      const ranges: Range[] = []
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? "").toLocaleLowerCase("en-US")
        for (let at = text.indexOf(q); at >= 0; at = text.indexOf(q, at + q.length)) {
          const range = new Range()
          range.setStart(node, at)
          range.setEnd(node, at + q.length)
          ranges.push(range)
        }
      }
      highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges))
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(mark)
    }
    schedule()
    const observer = new MutationObserver(schedule)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      highlights.delete(HIGHLIGHT_NAME)
    }
  }, [container, query])
}
