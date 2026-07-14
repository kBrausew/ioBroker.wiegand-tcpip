# Multi-controller smoke + dev lab scripts

Use this workflow to simulate multi-controller operation with seeded cards/swipes and verify ioBroker admin availability.

## Quickstart

```bash
npm ci
npm run smoke:setup
npm run smoke:multicontroller
```

## Manual setup (equivalent to `smoke:setup`)

```bash
npm run simulator:setup
npx @iobroker/dev-server setup
```

## Start/Stop overview

```bash
# one-shot smoke run (start -> verify -> stop automatically)
npm run smoke:multicontroller

# user-ops multicontroller smoke (runs full simulator regression for stable user-ops coverage)
npm run smoke:userops

# persistent dev lab
npm run devlab:start
# open http://127.0.0.1:8081
npm run devlab:stop

# stop alias
npm run smoke:stop
```

## Behavior notes

1. `smoke:multicontroller` stops itself automatically.
2. `devlab:start` keeps services running until `devlab:stop` (or `smoke:stop`).
3. If a process survives due to permissions, rerun stop command in elevated PowerShell.

## What is seeded by start/smoke scripts

1. Two simulated controllers (`405419896`, `405419897`)
2. Test cards + swipe events for merge/deny/grant scenarios
3. Reachability check for the admin endpoint
