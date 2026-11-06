---
name: Google Places server key
description: Google Maps key restrictions required by the server-side address autocomplete proxy.
---

# Google Places server key

The address autocomplete key must have Places API (New) enabled. Use no application restriction and restrict the key to Places API (New); do not apply an HTTP referrer restriction.

**Why:** JobsOxo proxies Places requests through its server so the key is never exposed to browsers. Google rejects those requests as `API_KEY_HTTP_REFERRER_BLOCKED` when the key expects a browser referrer. Replit egress addresses are not suitable for a fixed IP allowlist.

**How to apply:** Keep `GOOGLE_MAPS_API_KEY` secret, call Google only from server code, and control spend with Google API restrictions and project quotas.