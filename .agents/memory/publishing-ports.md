---
name: Publishing ports
description: Keep auxiliary design previews from adding unsupported public ports to Autoscale publishing.
---

Keep only the main application's public port mapping when using Autoscale. Auxiliary design-preview services can retain their internal ports without another external mapping.

**Why:** Replit documents that Autoscale supports only one exposed external port. An additional mapping for the design sandbox was found during a publishing failure after compilation succeeded, at the “Creating Autoscale service” stage.

**How to apply:** When adding or reconfiguring preview services, check that they do not introduce a second external port. Preserve their internal service configuration and verify both the app and preview routes. A publishing retry is required to confirm that a configuration fix resolves the failed release.
