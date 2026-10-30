# 0008. Tokens are shared with DPRcalc; components are not

Status: accepted

## Context

The designs match DPRcalc's dark theme value for value, but the two apps use different stacks (Chakra there, Tailwind and base-ui here).

## Decision

`@yipe/tokens` holds the CSS tokens and framework-free data (classes, rarity, swatches), synced from a DPRcalc checkout by a script and committed. Components stay in `@troubadour/ui`.

## Consequences

Colour has one source of truth without forcing one component library. Later the package can be published and used by both.

## Alternatives

Sharing components too: deferred until both apps use one stack.
