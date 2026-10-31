import type { Schemas } from "../generated/index.ts"

/* ---- Troubadour Cloud (opt-in backup of the open campaign's vault) ---- */
/** One backup: when, which snapshot, and what it held. `message` is "<device> · <summary>". */
export type CloudBackup = Schemas["CloudBackup"]
/**
 * Backup state for the open campaign. `main_device` is the computer that made the newest backup and `is_main`
 * says it is this one; `paused_live` is true while a session runs and automatic backups wait.
 */
export type CloudStatus = Schemas["CloudStatus"]
/** One backup attempt, successful or not (GET /api/cloud/history, 90 days). */
export type BackupAttempt = Schemas["BackupAttempt"]
export type CloudHistory = Schemas["CloudHistory"]
/** Who is signed in (GET /api/cloud/account). `avatar` is a data: URL. */
export type CloudAccount = Schemas["CloudAccount"]
/** A campaign in Troubadour Cloud (backed up from any computer), to restore from. */
export type CloudVault = Schemas["CloudVault"]
