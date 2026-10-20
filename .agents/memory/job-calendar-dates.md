---
name: Job calendar dates
description: Preserve job start/end calendar dates across API serialization, local display and editing.
---

Treat job start and end dates as calendar days, not time-of-day instants.

**Why:** Date-only job inputs are serialized as UTC midnight. Interpreting that value as a local timestamp in America/New_York moves the job to the preceding day, affecting timeline placement, weekend detection and prefilled edit fields.

**How to apply:** Preserve the encoded calendar day for scheduling and display, including ISO API values. Normalize calendar dates before passing them into legacy editors that format Date objects in local time. Verify both the timeline and reopened editor in America/New_York. Do not apply this rule to actual event timestamps such as creation times.
