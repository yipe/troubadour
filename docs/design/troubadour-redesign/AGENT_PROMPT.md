Paste this to your coding agent (Claude Code etc.) from the root of the troubadour repo, with this folder copied to `docs/design/troubadour-redesign/`:

---

Implement the Troubadour redesign described in `docs/design/troubadour-redesign/`.

1. Read `docs/design/troubadour-redesign/README.md` (specs, tokens, the decisions already made), then `IMPLEMENTATION_PLAN.md` (phases and what "done" means for each), then the repo's `AGENTS.md`, `web/AGENTS.md` and `backend/AGENTS.md`.
2. For each screen, look at the PNG in `screenshots/` and open the matching `.dc.html` file in a browser to check exact values and behavior. `Live Prototype.dc.html` is interactive. The HTML files are design references only: don't copy them into the app. Rebuild them with the existing React + Tailwind + shadcn + lucide stack.
3. Work one phase at a time, in order. Before you start a phase, list the files you'll change. After each phase, run `yarn check`, add tests for the new behavior, and stop for my review before going on.
4. Ask me before changing anything in `lib/types.ts` or the backend API contract, or before migrating how facts are stored in the Obsidian vault.
5. Don't build anything listed under "Out of scope".

Start with Phase 0.
