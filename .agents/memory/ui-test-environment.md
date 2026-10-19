---
name: UI test environment
description: Explicit jsdom selection is needed for client component tests under the installed test runner.
---

Start new React component test files with `// @vitest-environment jsdom`.

**Why:** The installed Vitest runner does not apply the legacy `environmentMatchGlobs` configuration here. Without an explicit file directive, a `.test.tsx` file can run in Node and fail with `document is not defined`, even while neighboring component tests pass.

**How to apply:** Specify jsdom in each new browser-component test rather than changing the global environment, since server and pure model tests must continue running in Node.

For mobile Chromium checks, compare both document scroll width and viewport width to the configured emulated screen width, not only to each other.

**Why:** Mobile Chromium can expand its layout viewport to accommodate overflowing content. Equal document and viewport widths can therefore falsely suggest that the page fits the phone.

**How to apply:** Assert that neither width exceeds the intended CSS-pixel width, and separately check that wide tables scroll inside their own container.
