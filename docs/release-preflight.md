# Release Preflight (step by step)

Use the full checklist in [docs/release-checklist.md](release-checklist.md).

Short version:
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
