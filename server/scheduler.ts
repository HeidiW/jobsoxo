/**
 * Background scheduler for periodic Gmail inbox sync.
 *
 * Runs a sync for all users who already have inbox tasks at a configurable
 * time each day (default: 08:00 local server time). The hour can be overridden
 * via the INBOX_SYNC_HOUR environment variable (0-23).
 *
 * lastSyncedAt is persisted in the settings table so it survives restarts.
 */

import { storage } from "./storage";
import { fetchGmailInbox, isGmailConnected } from "./gmail";
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

async function syncInboxForUsersWithTasks(): Promise<void> {
  const connected = await isGmailConnected();
  if (!connected) {
    log("Inbox auto-sync skipped — Gmail not connected", "scheduler");
    return;
  }

  const targetUsers = await storage.getUsersWithInboxTasks();
  if (targetUsers.length === 0) {
    log("Inbox auto-sync skipped — no users with inbox tasks found", "scheduler");
    return;
  }

  let synced = 0;
  let errors = 0;

  const messages = await fetchGmailInbox(50);

  for (const user of targetUsers) {
    try {
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
    `Inbox auto-sync complete — ${messages.length} messages, ${synced} users synced, ${errors} errors`,
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
 * Start the daily inbox auto-sync scheduler.
 * Call once at server startup.
 */
export function startInboxScheduler(): void {
  const syncHour = Math.min(
    23,
    Math.max(0, parseInt(process.env.INBOX_SYNC_HOUR ?? "8", 10) || 8)
  );

  const scheduleNext = () => {
    const delay = msUntilNextHour(syncHour);
    const nextRun = new Date(Date.now() + delay);
    log(
      `Inbox auto-sync scheduled for ${nextRun.toLocaleTimeString()} (in ${Math.round(delay / 60_000)} min)`,
      "scheduler"
    );

    schedulerTimer = setTimeout(async () => {
      log("Inbox auto-sync starting…", "scheduler");
      try {
        await syncInboxForUsersWithTasks();
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
