# 0004. Review actions go through one server endpoint

Status: accepted

## Context

Review accepts or rejects a suggestion beside its transcript lines and shows progress ("5 of 14"). A reject removes the suggestion from the vault, so a count taken from the vault shrinks.

## Decision

`POST /api/sessions/{id}/review/{item_id} {action}` calls the same vault operations as the older endpoints and records the decision in `sessions/<id>/review.json`, which holds a frozen item list and the decisions.

## Consequences

Progress stays right after a reject, and a failure cannot leave an action applied but unrecorded. Review has its own small module (`troubadour.lore.review`).

## Alternatives

Two client calls (do the action, then record it) could disagree after a failure.
