---
name: Publishing ports
description: Keep auxiliary design previews from adding unsupported public ports to Autoscale publishing.
---

Keep only the main application's public port mapping when using Autoscale. Auxiliary design-preview services can retain their internal ports without another external mapping.

**Why:** Replit documents that Autoscale supports only one exposed external port. An additional mapping for the design sandbox was found during a publishing failure after compilation succeeded, at the “Creating Autoscale service” stage.

**How to apply:** When adding or reconfiguring preview services, check that they do not introduce a second external port. Preserve their internal service configuration and verify both the app and preview routes. A publishing retry is required to confirm that a configuration fix resolves the failed release.

The extra external mapping can recur as an uncommitted workspace change even when the committed configuration is correct; the source of its restoration is not established. Inspect the working copy immediately before publishing rather than assuming the earlier correction persists.

Do not assume a failure at “Creating Autoscale service” is caused by ports. Later revision-scoped investigation showed normal application startup and only the main port forwarded despite promotion failing after long service-creation delays. The earlier port explanation was not a confirmed root cause.

**Why:** A successful publish following a configuration change is correlation, not proof; the same startup probe warnings occurred in both successful and failed revisions.

**How to apply:** For failed promotions, use revision-scoped runtime logs through the reliability investigation workflow. Logs pinned to the serving version cannot establish why a new revision failed. If the app starts normally but service creation is delayed, report the uncertainty and seek platform-side operation details instead of repeatedly changing app configuration.
