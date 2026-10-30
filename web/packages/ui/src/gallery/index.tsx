import type { ComponentType } from "react"

type SectionModule = { title: string; Section: ComponentType }

// Vite only rewrites a literal `import.meta.glob(` call, and it is not a dependency of this
// package, so its typing is declared here.
declare global {
  interface ImportMeta {
    glob<T>(pattern: string, options: { eager: true }): Record<string, T>
  }
}

const modules = import.meta.glob<SectionModule>("./sections/*.tsx", { eager: true })

const sections = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, mod]) => ({ path, ...mod }))

export function Gallery() {
  return (
    <div className="flex flex-col gap-10 p-6">
      {sections.map(({ path, title, Section }) => (
        <section key={path} className="flex flex-col gap-4">
          <h2 className="border-b border-line pb-2 font-serif text-24 font-bold text-ink">{title}</h2>
          <Section />
        </section>
      ))}
    </div>
  )
}
