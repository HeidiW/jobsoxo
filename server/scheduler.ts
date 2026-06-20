/**
 * Background scheduler for periodic Gmail inbox sync.
 *
 * Runs a daily sync for every user who has connected their own Gmail account
 * (i.e. has a row in the google_tokens table). The sync hour is configurable
 * via the Settings page (persisted in the settings table) or the
 * INBOX_SYNC_HOUR environment variable (0-23). Defaults to 08:00.
 *
 * lastSyncedAt is persisted in the settings table so it survives restarts.
 */

import { storage } from "./storage";
import { fetchUserGmailInbox } from "./gmail";
import { log } from "./index";

let schedulerTimer: ReturnType<typeof setTimeout> | null = null;

/** Read the persisted last-sync timestamp from the database. */
export async function getLastInboxSyncTime(): Promise<Date | null> {
  try {
    const s = await storage.getSettings();
    return s?.lastInboxSync ?? null;
  } catch {
    return null;
  }
}

export async function syncInboxForConnectedUsers(): Promise<void> {
  const connectedUsers = await storage.getUsersWithGmailTokens();

  if (connectedUsers.length === 0) {
    log("Inbox auto-sync skipped — no users with Gmail connected", "scheduler");
    return;
  }

  let synced = 0;
  let errors = 0;

  for (const user of connectedUsers) {
    try {
      const messages = await fetchUserGmailInbox(user.id, 50);
      await Promise.all(
        messages.map((m) =>
          storage.upsertInboxTask({
            userId: user.id,
            emailId: m.id,
            subject: m.subject,
            sender: m.sender,
            senderEmail: m.senderEmail ?? null,
            snippet: m.snippet ?? null,
            receivedAt: m.receivedAt,
            isRead: m.isRead,
            isDone: false,
          })
        )
      );
      synced++;
    } catch (err) {
      log(`Inbox auto-sync error for user ${user.id}: ${err}`, "scheduler");
      errors++;
    }
  }

  const syncTime = new Date();
  await storage.setLastInboxSync(syncTime);

  log(
    `Inbox auto-sync complete — ${connectedUsers.length} users processed, ${synced} synced, ${errors} errors`,
    "scheduler"
  );
}

/**
 * Compute milliseconds until the next occurrence of `hour:00` local time.
 * If that time is in the past today, schedule it for tomorrow.
 */
function msUntilNextHour(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

/**
 * Return the next Date at which the inbox sync is scheduled to fire.
 * Reads the configured hour from the database (same logic as the scheduler).
 */
export async function getNextInboxSyncTime(): Promise<Date> {
  const hour = await getInboxSyncHour();
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/**
 * Read the configured inbox sync hour from the database.
 * Falls back to the INBOX_SYNC_HOUR env var, then to 8.
 */
async function getInboxSyncHour(): Promise<number> {
  try {
    const s = await storage.getSettings();
    if (s?.inboxSyncHour != null) {
      return Math.min(23, Math.max(0, s.inboxSyncHour));
    }
  } catch {
    // ignore — fall through to env/default
  }
  return Math.min(
    23,
    Math.max(0, parseInt(process.env.INBOX_SYNC_HOUR ?? "8", 10) || 8)
  );
}

/**
 * Start the daily inbox auto-sync scheduler.
 * Call once at server startup.
 * The sync hour is re-read from the database at each rescheduling cycle,
 * so changes take effect without a server restart.
 */
export function startInboxScheduler(): void {
  const scheduleNext = async () => {
    const syncHour = await getInboxSyncHour();
    const delay = msUntilNextHour(syncHour);
    const nextRun = new Date(Date.now() + delay);
    log(
      `Inbox auto-sync scheduled for ${nextRun.toLocaleTimeString()} (in ${Math.round(delay / 60_000)} min)`,
      "scheduler"
    );

    schedulerTimer = setTimeout(async () => {
      log("Inbox auto-sync starting…", "scheduler");
      try {
        await syncInboxForConnectedUsers();
      } catch (err) {
        log(`Inbox auto-sync failed: ${err}`, "scheduler");
      }
      scheduleNext();
    }, delay);
  };

  scheduleNext();
}

export function stopInboxScheduler(): void {
  if (schedulerTimer) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}
