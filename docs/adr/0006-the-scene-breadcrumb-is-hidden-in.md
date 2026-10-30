# 0006. The scene breadcrumb is hidden in the live view

Status: accepted

## Context

Scenes (a title and place per stretch of the session) come from the write-up's beats, which exist only after a session.

## Decision

Scenes are stored in `sessions/<id>/scenes.json` by the write-up and shown in Sessions and the Timeline. The live view shows no scene.

## Consequences

No live scene detector to build or get wrong. The live view has less context than the design drew.

## Alternatives

A live scene detector: deferred.
