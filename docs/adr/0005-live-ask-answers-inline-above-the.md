# 0005. Live ask answers inline above the ask bar

Status: accepted

## Context

Asking a question during a game must not take the transcript away from the table.

## Decision

The answer renders inline above the ask bar. The shared `AskAnswer` component (serif answer, numbered sources) is also what the Ask page uses.

## Consequences

One answer component for both places. A live overlay was not built.

## Alternatives

The overlay prototype (design screen 1g as a modal): not chosen.
