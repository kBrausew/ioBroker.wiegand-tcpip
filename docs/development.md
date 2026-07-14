# Development Guide

## Dev lab and smoke tests

Use this workflow to simulate multi-controller operation with seeded cards/swipes and verify ioBroker admin availability.

### Quickstart

```bash
npm ci
npm run smoke:setup
npm run smoke:multicontroller
```

### Manual setup (equivalent to `smoke:setup`)

```bash
npm run simulator:setup
npx @iobroker/dev-server setup
```

### Start/Stop overview

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

### Behavior notes

1. `smoke:multicontroller` stops itself automatically.
2. `devlab:start` keeps services running until `devlab:stop` (or `smoke:stop`).
3. If a process survives due to permissions, rerun stop command in elevated PowerShell.

### What is seeded by start/smoke scripts

1. Two simulated controllers (`405419896`, `405419897`)
2. Test cards + swipe events for merge/deny/grant scenarios
3. Reachability check for the admin endpoint

---

## Test coverage overview

### `smoke:multicontroller`
- Admin URL reachable (http://127.0.0.1:8081)
- Simulator REST reachable
- Two controllers seeded (405419896, 405419897)
- Test cards + swipe events seeded
- Self-terminating after pass/fail

### `smoke:userops`
- Wrapper: runs full regression suite via simulator
- Covers all user-ops messagebox flows end-to-end

### `test:regression` (14 tests, ~60s, requires simulator)
- Adapter connects; simulated swipe processed
- Unauthorized swipe → denied
- remoteOpen state → event counter update
- Messagebox: search + invalid command
- Self-generated remoteOpen ignored
- setip messagebox callback
- User management CRUD + event-based card merge
- Card merge across two controllers
- Import preview + apply (multi-controller)
- Import apply as background job
- Sync preview + background sync apply with selection
- Controller-scoped validation + reconcile preview
- Restore-resync preview + background apply

### `test:integration`
- ioBroker adapter-core harness start/stop (placeholder, no adapter-specific cases yet)

### `test:unit`
- ioBroker adapter-core unit harness (structural checks via `@iobroker/testing`)

---

1. Install dependencies: `npm ci`
2. Setup simulator: `npm run simulator:setup`
3. Typecheck: `npm run check`
4. Lint: `npm run lint`
5. JS + package tests: `npm test`
6. Unit tests: `npm run test:unit`
7. Integration tests: `npm run test:integration`
8. Regression tests: `npm run test:regression`
9. Verify metadata files (`README.md`, `io-package.json`, `package.json`)
10. Only release when all checks are green

---

## Release checklist (full)

This checklist is intended for a stable adapter release.
Run the steps in order and continue only if each step is green.

### 1) Prepare workspace

1. Open repository root.
2. Ensure correct branch is checked out.
3. Ensure no unrelated changes are pending.

### 2) Install dependencies cleanly

```bash
npm ci
```

### 3) Prepare simulator tooling

1. Run: `npm run simulator:setup`
2. Verify simulator binary exists under `.tools/uhppote-simulator`.

### 4) Static quality gates

```bash
npm run check
npm run lint
```

### 5) Test gates

```bash
npm test
npm run test:unit
npm run test:integration
npm run test:regression
```

### 6) Metadata and release docs

1. Verify `package.json` version and scripts.
2. Verify `io-package.json` `common.version` and `common.news`.
3. Verify `README.md` reflects current requirements and test process.
4. Verify `CHANGELOG.md` contains current release section.

### 7) Security and dependency review

```bash
npm audit
```

Evaluate findings before release.

### 8) Final git checks

```bash
git status --short
git diff --stat
```

Ensure only intended files are included.

### 9) Release readiness decision

1. All checks green.
2. No known blocker issues.
3. Changelog and metadata complete.

### 10) Publish flow (when approved)

1. Commit final release prep changes.
2. Push branch.
3. Create or update PR to master.
4. Merge after CI and review are green.
5. Tag release version.
