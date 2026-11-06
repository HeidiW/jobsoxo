import type { InboxTask } from "@shared/schema";

export type EmailStatus = "todo" | "snoozed" | "done";

export interface EmailStateGroups {
  todo: InboxTask[];
  snoozed: InboxTask[];
  done: InboxTask[];
  dismissed: InboxTask[];
}

/** Snooze until the next local calendar day, not the server's UTC midnight. */
export function tomorrowSnoozeUntil(now = new Date()): string {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.toISOString();
}

/**
 * The active tasks endpoint includes expired snoozes; only a future timestamp
 * means snoozed. Merge active and hidden caches by Gmail id so counts and rows
 * remain stable while queries refresh.
 */
export function partitionEmailTasks(
  activeTasks: InboxTask[],
  hiddenTasks: InboxTask[],
  now = new Date(),
): EmailStateGroups {
  const merged = new Map<string, InboxTask>();
  for (const task of activeTasks) merged.set(task.emailId, task);
  for (const task of hiddenTasks) merged.set(task.emailId, task);

  const groups: EmailStateGroups = { todo: [], snoozed: [], done: [], dismissed: [] };
  for (const task of merged.values()) {
    if (task.permanentlyDeleted) continue;
    if (task.dismissed) {
      groups.dismissed.push(task);
      continue;
    }
    if (task.isDone) {
      groups.done.push(task);
      continue;
    }
    const snoozeTime = task.snoozedUntil ? new Date(task.snoozedUntil).getTime() : NaN;
    if (Number.isFinite(snoozeTime) && snoozeTime > now.getTime()) {
      groups.snoozed.push(task);
    } else {
      groups.todo.push(task);
    }
  }

  const newestFirst = (a: InboxTask, b: InboxTask) =>
    new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
  groups.todo.sort(newestFirst);
  groups.snoozed.sort((a, b) =>
    new Date(a.snoozedUntil!).getTime() - new Date(b.snoozedUntil!).getTime()
  );
  groups.done.sort(newestFirst);
  groups.dismissed.sort(newestFirst);
  return groups;
}
