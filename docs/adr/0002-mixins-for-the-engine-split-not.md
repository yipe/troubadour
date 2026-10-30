# 0002. Mixins for the engine split, not composition

Status: accepted

## Context

`engine.py` was a 2.4k-line `Engine`. The server and about 700 lines of engine tests call its public methods.

## Decision

`Engine` stays one class, assembled from mixins in `troubadour.engine` (`core.py`, `_pipeline.py`, `_sessions.py`, `_library.py`, `_voices.py`, `_training.py`, `notebook.py`). The public methods do not change.

## Consequences

Callers and tests did not change, and files are readable sizes. The mixins still share state and one lock, so the seams are by convention only.

## Alternatives

Composition (objects for library, voices and pipeline sharing one lock) is the better long-term shape but a behaviour-risky refactor. It is left for later, using the seams the mixins create.
