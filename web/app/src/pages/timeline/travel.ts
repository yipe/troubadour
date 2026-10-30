/** How many horizontal positions the travel line has. */
export const MAX_LANES = 6

export interface TravelStop {
  /** Index of the lane (0 to MAX_LANES - 1) the line is in during this session. */
  lane: number
  /** The place the party is in, or null while the campaign hasn't named one yet. */
  place: string | null
  /** The session arrives somewhere new (the first place, or a change of place): labelled, accent dot. */
  arrives: boolean
}

/**
 * Where the travel line is in each session. `places` is oldest session first (one list per session, in the
 * order visited; the last is where the party ended up, so it is where the line sits). A place keeps the lane it got on its first appearance;
 * once all lanes are taken, the next new place reuses the lane of the place visited longest ago. A session
 * without places continues the line where it was.
 */
export function travelStops(places: string[][]): TravelStop[] {
  const lanes = new Map<string, { lane: number; lastUsed: number }>()
  let current: string | null = null
  return places.map((list, i) => {
    const place = list.at(-1) ?? null
    if (place === null) {
      return { lane: current === null ? 0 : (lanes.get(current)?.lane ?? 0), place: current, arrives: false }
    }
    let entry = lanes.get(place)
    if (!entry) {
      let lane = lanes.size
      if (lane >= MAX_LANES) {
        const [oldest] = [...lanes].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
        const [evicted, { lane: freed }] = oldest!
        lanes.delete(evicted)
        lane = freed
      }
      entry = { lane, lastUsed: i }
      lanes.set(place, entry)
    }
    entry.lastUsed = i
    const arrives = place !== current
    current = place
    return { lane: entry.lane, place, arrives }
  })
}
