#!/bin/bash
set -euo pipefail

npm install --no-audit --no-fund

# Keep post-merge setup non-interactive without approving destructive schema
# changes. Drizzle asks whether to truncate a table for some constraints; the
# safe answer is "No, add the constraint without truncating the table".
printf 'n\n' | npm run db:push
