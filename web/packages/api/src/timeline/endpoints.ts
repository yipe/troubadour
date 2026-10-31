import { req } from "../http/index.ts"
import type { Appearances, Timeline } from "./types.ts"

/** Sessions of the open campaign, newest first. */
export const timeline = () => req<Timeline>("GET", "/api/campaign/timeline")

/** Mentions of every entry in every session, for the Codex list. */
export const appearances = () => req<Appearances>("GET", "/api/campaign/appearances")
