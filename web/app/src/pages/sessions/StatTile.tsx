export function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-card border border-line bg-surface px-3.5 py-3">
      <div className="text-22 font-bold tabular-nums">{value}</div>
      <div className="text-12 text-ink-subtle">{label}</div>
    </div>
  )
}
