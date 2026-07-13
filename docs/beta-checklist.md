# Beta Checklist (2.0.0 Feature Branch)

## Goal
Define a clear pass/fail gate for a beta candidate of the user-management feature set.

## Entry Criteria
- [ ] Branch is up to date with `master` (no missing commits).
- [ ] Version is set to `2.0.0` in `package.json`, `io-package.json`, and lockfile root.
- [ ] `io-package.json` news history contains `0.4.7`, `0.4.6`, `1.0.0`, and `2.0.0`.

## Build and Quality Gates
- [ ] `npm run check` passes.
- [ ] `npm run lint` passes (warnings allowed, no errors).
- [ ] `npm run test:js` passes.
- [ ] `npm run test:unit` passes.
- [ ] `npm run test:integration` passes.
- [ ] `npm run test:package` passes.
- [ ] `npm run test:regression` passes on Windows dev host and at least one clean rerun.

## Feature Validation (User Management)
- [ ] `userList`, `userGet`, `userUpsert`, `userDelete` work via messagebox API.
- [ ] User credential/card merge from swipe events is persisted as expected.
- [ ] Background jobs can be listed and inspected (`userJobList`, `userJobGet`).
- [ ] Import preview/apply supports delta and overwrite modes.
- [ ] Review/approval flow is enforced before apply operations.

## UI Validation
- [ ] User Ops panel works in Basic mode without exposing power-only actions.
- [ ] Power mode unlocks advanced controls and keeps scope restrictions intact.
- [ ] Job Monitor tab updates live and shows status/error details correctly.
- [ ] No console errors in admin UI while switching modes/tabs.

## Non-Functional Checks
- [ ] Adapter startup is stable with valid controller config.
- [ ] No data corruption in cards/user states after repeated import/apply cycles.
- [ ] Error messages are actionable for failed sync/import jobs.

## Exit Criteria (Beta Ready)
- [ ] All sections above are green.
- [ ] PR #64 checks are green.
- [ ] Reviewer/maintainer acknowledged beta scope.

## Current Status Snapshot (2026-07-13)
- Branch sync: merged `master` into feature branch.
- PR #64 checks: green.
- Regression test: simulator startup hardening applied (dynamic port selection + explicit process diagnostics).
- Regression test: currently still failing in controller communication phase (timeouts after startup); further transport-level analysis required.
