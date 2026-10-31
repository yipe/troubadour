import { req } from "../http/index.ts"
import type { StorageUsage } from "./types.ts"

/** Bytes used by recordings, voices, notes and everything else in the data folder. */
export const storage = () => req<StorageUsage>("GET", "/api/storage")
