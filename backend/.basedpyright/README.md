# basedpyright baseline

`baseline.json` records the type errors that existed when type checking was introduced. Errors listed
there are not reported; any new error fails `uv run basedpyright` (and `yarn typecheck`).

When your change fixes baselined errors, run `uv run basedpyright --writebaseline` from `backend/` and
commit the smaller file. Never regenerate the baseline to hide new errors: fix them instead.
