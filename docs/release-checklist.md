# Release checklist

This checklist is intended for a stable adapter release.
Run the steps in order and continue only if each step is green.

## 1) Prepare workspace
1. Open repository root.
2. Ensure correct branch is checked out.
3. Ensure no unrelated changes are pending.

## 2) Install dependencies cleanly
1. Run: npm ci

## 3) Prepare simulator tooling
1. Run: npm run simulator:setup
2. Verify simulator binary exists under .tools/uhppote-simulator.

## 4) Static quality gates
1. Run: npm run check
2. Run: npm run lint

## 5) Test gates
1. Run: npm test
2. Run: npm run test:unit
3. Run: npm run test:integration
4. Run: npm run test:regression

## 6) Metadata and release docs
1. Verify package.json version and scripts.
2. Verify io-package.json common.version and common.news.
3. Verify README.md reflects current requirements and test process.
4. Verify CHANGELOG.md contains current release section.

## 7) Security and dependency review
1. Run: npm audit
2. Evaluate findings before release.

## 8) Final git checks
1. Run: git status --short
2. Run: git diff --stat
3. Ensure only intended files are included.

## 9) Release readiness decision
1. All checks green.
2. No known blocker issues.
3. Changelog and metadata complete.

## 10) Publish flow (when approved)
1. Commit final release prep changes.
2. Push branch.
3. Create or update PR to master.
4. Merge after CI and review are green.
5. Tag release version.
