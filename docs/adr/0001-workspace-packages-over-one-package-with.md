# 0001. Workspace packages over one package with sub-modules

Status: accepted

## Context

The backend was one `troubadour` package of 30 modules. Facts, write-ups, Ask and review need no ML wheels, but everything installed together, and nothing stopped a lore module importing torch.

## Decision

The backend is a uv workspace of six packages (`core`, `sound`, `lore`, `cloud`, `engine`, `server`) with a layering rule enforced by import-linter in `tests/test_layers.py`: `server -> engine -> cloud -> lore | sound -> core`. `lore` installs without ML dependencies.

## Consequences

Dependencies are explicit and a layer violation fails `yarn check`. Imports moved (`troubadour.core.config`, not `troubadour.config`), and each package has its own `pyproject.toml` to keep in step.

## Alternatives

One package plus import-linter was cheaper and was rejected: it would not have made `lore` installable without ML wheels.
