/* ---- Troubadour Cloud (opt-in backup of the open campaign's vault) ---- */
export interface CloudBackup {
  at: number /* epoch s */
  snapshot: string
  files: number
  bytes: number
  uploaded: number /* files new or changed in that backup */
  unchanged: boolean
  skipped: string[] /* "path: why", at most 50 */
  quota: { used_bytes: number; limit_bytes: number; after_bytes: number }
  fingerprint: string
}
export interface CloudStatus {
  url: string
  connected: boolean
  campaign: string /* the campaign the settings below belong to */
  include_transcripts: boolean
  auto_backup: boolean /* back up by itself a couple of minutes after notes change */
  last_backup: CloudBackup | null
  last_error: { at: number; message: string } | null /* the last backup failed; cleared by a good one */
}
/** Who is signed in to Troubadour Cloud (GET /api/cloud/account). `avatar` is a data: URL. */
export interface CloudAccount {
  email: string | null
  name: string | null
  avatar: string | null
}

/** A campaign in Troubadour Cloud (backed up from any Mac), to restore from. */
export interface CloudVault {
  id: string
  name: string
  campaign_id: string
  head_snapshot: string | null
  created_at: string
}
