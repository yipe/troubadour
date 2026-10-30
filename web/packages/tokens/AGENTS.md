# @yipe/tokens

Colour tokens and class/rarity/swatch data shared with DPRcalc (filled in by U0). No dependencies.

- Exports `tokens.css` and `./*` (TypeScript in `src/`).
- `pnpm -C packages/tokens test`, `pnpm -C packages/tokens typecheck`.
- Must import nothing: pnpm's strict `node_modules` makes any import fail.
