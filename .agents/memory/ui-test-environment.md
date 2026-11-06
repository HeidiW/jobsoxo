---
name: UI test environment
description: Client test setup, mobile overflow checks, safe Settings verification, and headless focus behavior.
---

Start new React component test files with `// @vitest-environment jsdom`.

**Why:** The installed Vitest runner does not apply the legacy `environmentMatchGlobs` configuration here. Without an explicit file directive, a `.test.tsx` file can run in Node and fail with `document is not defined`, even while neighboring component tests pass.

**How to apply:** Specify jsdom in each new browser-component test rather than changing the global environment, since server and pure model tests must continue running in Node.

For mobile Chromium checks, compare both document scroll width and viewport width to the configured emulated screen width, not only to each other.

**Why:** Mobile Chromium can expand its layout viewport to accommodate overflowing content. Equal document and viewport widths can therefore falsely suggest that the page fits the phone.

**How to apply:** Assert that neither width exceeds the intended CSS-pixel width, and separately check that wide tables scroll inside their own container.

Do not treat a fitting body or table wrapper as proof that a wide ledger is contained. Check the document root too, and give the scrolling region its own positioning context where necessary.

**Why:** Chromium allowed wide table descendants to enlarge the document root even though the body and scroll wrapper fit the phone. Establishing a local positioning context contained that overflow without hiding content.

**How to apply:** Keep horizontal scrolling local to the ledger, verify it actually scrolls, and check root width after resizing and opening dialogs. Do not mask the problem with global overflow suppression.

Use view/draft-only browser checks for company settings and payment-reminder configuration. Exercise their save/failure flows with mocked requests in component tests, not writes to the running application's shared configuration.

**Why:** A temporary user does not isolate company settings. Changing reminder enablement or sync schedules during a UI check can affect real users or trigger external automation.

**How to apply:** Browser-test admin/member visibility, draft editing, validation, and layout without submitting shared settings or triggering provider actions. A temporary user's own profile can be saved and verified independently, then removed with the test account.

Enable focus emulation for interactive headless CDP checks instead of assuming the browser window has focus.

**Why:** In this environment, `element.focus()` can change `document.activeElement` while `document.hasFocus()` stays false and React's focus handler does not run. This falsely suggested that address suggestions were broken even with deterministic mocked responses.

**How to apply:** Call `Emulation.setFocusEmulationEnabled({ enabled: true })` for the test session, verify `document.hasFocus()`, and blur/refocus an already-active input before checking focus-dependent UI.
