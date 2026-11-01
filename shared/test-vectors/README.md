# Shared test vectors

Cases both the Python and the TypeScript implementations must pass; edit here, never copy into a test.

- `hms.json`: `[seconds, "h:mm:ss form"]` pairs. Fractional seconds are floored.
- `session-numbers.json`: session lists and the number each session gets. Sessions are numbered by
  `started_at` (ties broken by `id`); a session absorbed into another (listed in the survivor's
  `merged_from`) gets no number.
- `vault-format.json`: vault format v1 (`troubadour.cloud.vault_format`), the `_Overview/Timeline.md` and
  `_Overview/Recaps/*.md` pages the cloud website reads. `input` → exact `markdown` (Troubadour writes it) →
  `front_matter` (what a YAML parser must read back; the website parses it).
