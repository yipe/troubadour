import type { CampaignJob } from "../campaign/types.ts"
import { req } from "../http/index.ts"
import type { CloudAccount, CloudStatus, CloudVault } from "./types.ts"

export const cloud = () => req<CloudStatus>("GET", "/api/cloud")

/** Start signing in to Troubadour Cloud: the first call that reaches the service. Open the returned page. */
export const cloudConnect = () => req<{ authorize_url: string }>("POST", "/api/cloud/connect")

export const cloudDisconnect = () => req<CloudStatus>("POST", "/api/cloud/disconnect")

export const cloudOptions = (options: { include_transcripts?: boolean; auto_backup?: boolean }) =>
  req<CloudStatus>("PUT", "/api/cloud/options", options)

/** Back up the open campaign's notes (background job, kind "backup"). */
export const cloudBackup = () => req<CampaignJob>("POST", "/api/cloud/backup")

/** This account's campaigns in Troubadour Cloud, from any Mac. */
export const cloudVaults = () => req<CloudVault[]>("GET", "/api/cloud/vaults")

/** Who is signed in (name, email, avatar as a data: URL); the profile fields are null for an older sign-in. */
export const cloudAccount = () => req<CloudAccount>("GET", "/api/cloud/account")

/** Bring a backed-up campaign's newest notes back, adding the campaign if this Mac lacks it (job "restore"). */
export const cloudRestore = (vault_id: string) => req<CampaignJob>("POST", "/api/cloud/restore", { vault_id })
