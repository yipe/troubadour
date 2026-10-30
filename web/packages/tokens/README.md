# @yipe/tokens

Colour tokens and class, rarity and swatch data shared with DPRcalc. No UI framework, no dependencies.

- `tokens.css`: CSS custom properties for the dark, light and midnight themes.
- `src/classes.ts`: the 12 SRD classes, their base colours, `classColorVar()`.
- `src/rarity.ts`: rarity names and `rarityColorVar()`.
- `src/palette.ts`: the swatch palette (hues x light/medium/dark) and colour names.

Everything except this README, the script and the tests is **generated**. Do not edit it by hand.

## Sync

```
pnpm -C web/packages/tokens sync
```

Reads a DPRcalc checkout from `$DPR_DIR` (default `~/src/dpr`, read-only), keeps the allow-listed groups,
drops comments, and records the source commit and anything dropped in `SOURCE.md`. If the checkout is
missing it prints a note and changes nothing. CI never runs it; the generated files are committed.

## Publish later

1. New public repo `yipe/tokens`. Move the generated files there as the source, then publish `@yipe/tokens`.
2. DPRcalc: `tokens.css` does `@import "@yipe/tokens/tokens.css"` and keeps only its app-only groups.
   `classColors.ts` and `postChartPalette.ts` re-export from the package.
3. Troubadour: replace the workspace package with the npm dependency and delete the sync script.
