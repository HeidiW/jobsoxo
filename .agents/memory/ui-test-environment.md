---
name: UI test environment
description: Explicit jsdom selection is needed for client component tests under the installed test runner.
---

Start new React component test files with `// @vitest-environment jsdom`.

**Why:** The installed Vitest runner does not apply the legacy `environmentMatchGlobs` configuration here. Without an explicit file directive, a `.test.tsx` file can run in Node and fail with `document is not defined`, even while neighboring component tests pass.

**How to apply:** Specify jsdom in each new browser-component test rather than changing the global environment, since server and pure model tests must continue running in Node.
