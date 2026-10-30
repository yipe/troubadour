import { req } from "../http/index.ts"
import type { Timeline } from "./types.ts"

/** Sessions of the open campaign, newest first. */
export const timeline = () => req<Timeline>("GET", "/api/campaign/timeline")
