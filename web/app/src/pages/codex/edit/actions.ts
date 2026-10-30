import type { Entity } from "@troubadour/api/campaign"

/** Stub: F15 wires these to the review endpoints. */
export function useHeardAsActions(_entity: Entity) {
  return {
    accept: (_heard: string) => {},
    reject: (_heard: string) => {},
  }
}

/** Stub: F15 wires these to confirming or deleting a suggested entry. */
export function useSuggestedEntryActions(_entity: Entity) {
  return {
    keep: () => {},
    remove: () => {},
  }
}
