/* ---- Audio: live level, quality read-outs, recording reports, mic details ---- */
export type AudioSource = "session" | "test"
export type LevelZone = "silent" | "quiet" | "good" | "hot" | "clip" | "off"
export interface AudioLevel {
  source: AudioSource
  db: number | null /* ~100 ms RMS, dBFS; null when the mic stopped */
  peak_db: number | null
  clipping: boolean
  zone: LevelZone
}
export type Grade = "good" | "ok" | "poor"
export interface QualityGrades {
  speech: Grade
  noise: Grade
  snr: Grade
  rumble: Grade
  clipping: Grade
}
/** The five numbers that say whether a mic is set up well. */
export interface QualityNumbers {
  speech_db: number
  noise_db: number
  snr_db: number
  rumble_pct: number
  clipped_pct: number
  grades: QualityGrades
}
export interface AudioQuality extends QualityNumbers {
  source: AudioSource
  window_s: number
  talking: boolean
  hints: string[]
}
export type QualityVerdict = "good" | "settings" | "microphone"
export type MicPattern =
  "omni" | "cardioid" | "supercardioid" | "hypercardioid" | "figure-8" | "stereo" | "boundary" | "beamforming"
export type MicCapsule = "dynamic" | "condenser" | "array"
export interface MicSpecs {
  source: "catalog" | "you" | "unknown"
  model?: string
  capsule?: MicCapsule
  patterns?: MicPattern[]
  bits?: number
  max_rate?: number
  wireless?: boolean
  notes?: string
}
export interface MicCheck {
  id: "around" | "distance" | "wired" | "rate" | "measured"
  label: string
  ok: boolean | null /* null = can't tell */
  detail: string
}
export interface MicInfo {
  name: string
  maker: string | null
  connection: "built-in" | "USB" | "Bluetooth" | "virtual" | "aggregate" | "other"
  rate: number | null
  default: boolean
  specs: MicSpecs
  measured: { session: string; started_at: number; verdict: QualityVerdict | "unknown"; reasons: string[] }[]
  checks: MicCheck[]
}
export type MicSpecsPatch = Partial<Pick<MicSpecs, "model" | "capsule" | "patterns" | "wireless" | "notes">>
