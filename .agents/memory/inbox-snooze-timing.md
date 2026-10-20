---
name: Inbox snooze timing
description: User-local meaning of tomorrow for timed email follow-ups.
---

Inbox's “tomorrow” snooze means midnight at the start of the next calendar day in the user's browser timezone. Send the resulting instant explicitly rather than relying on the server's default timezone.

**Why:** Server-local midnight can be earlier in the user's current calendar day when the server runs in UTC. The UI must not promise tomorrow while scheduling a same-day return. Calendar arithmetic also preserves the intended day across daylight-saving changes.

**How to apply:** Calculate the next local calendar day, then serialize the actual timestamp. Compare expiry as an instant; unlike job scheduling dates, snooze timestamps must not be reduced to their encoded date prefix.
