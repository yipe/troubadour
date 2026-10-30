# 0007. Cloud history is the local log of backup attempts

Status: accepted

## Context

The cloud settings page shows past backups and restores by snapshot.

## Decision

`cloud_history.json` in the data dir records every attempt (successes and failures, 90 days) and `GET /api/cloud/history` serves it. Restore takes an optional snapshot id.

## Consequences

It works offline and needs nothing from the cloud service. It shows only this Mac's attempts, not other devices' snapshots.

## Alternatives

A server-side snapshot list depends on the separate cloud service and is deferred.
