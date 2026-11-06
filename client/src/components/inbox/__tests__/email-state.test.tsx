// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { InboxTask } from "@shared/schema";
import { partitionEmailTasks, tomorrowSnoozeUntil } from "@/components/inbox/email-state";

function task(overrides: Partial<InboxTask> = {}): InboxTask {
  return {
    id: "row",
    userId: "user",
    emailId: "email",
    subject: "A client email",
    sender: "Taylor Reed",
    senderEmail: "taylor@example.com",
    snippet: "Can we review this?",
    receivedAt: new Date("2025-01-03T10:00:00Z"),
    isRead: true,
    isDone: false,
    dismissed: false,
    snoozedUntil: null,
    permanentlyDeleted: false,
    createdAt: new Date("2025-01-03T10:00:00Z"),
    ...overrides,
  } as InboxTask;
}

describe("Inbox email status presentation", () => {
  const now = new Date("2025-01-04T12:00:00Z");

  it("uses only a future snooze timestamp for Snoozed and returns expired mail to To do", () => {
    const groups = partitionEmailTasks([
      task({ emailId: "future", snoozedUntil: new Date("2025-01-05T00:00:00Z") }),
      task({ emailId: "expired", snoozedUntil: new Date("2025-01-04T11:59:00Z") }),
      task({ emailId: "older", receivedAt: new Date("2024-12-01T08:00:00Z") }),
    ], [], now);

    expect(groups.snoozed.map(item => item.emailId)).toEqual(["future"]);
    expect(groups.todo.map(item => item.emailId)).toEqual(["expired", "older"]);
    expect(groups.done).toHaveLength(0);
  });

  it("counts completed persisted tasks as Done and keeps dismissed records separate", () => {
    const groups = partitionEmailTasks([
      task({ emailId: "complete", isDone: true }),
      task({ emailId: "active" }),
    ], [
      task({ emailId: "hidden-complete", isDone: true, dismissed: true }),
      task({ emailId: "dismissed", dismissed: true }),
    ], now);

    expect(groups.done.map(item => item.emailId)).toEqual(["complete"]);
    expect(groups.dismissed.map(item => item.emailId).sort()).toEqual(["dismissed", "hidden-complete"]);
    expect(groups.todo.map(item => item.emailId)).toEqual(["active"]);
  });

  it("deduplicates the active and hidden caches by email id", () => {
    const activeVersion = task({ emailId: "same", snoozedUntil: null });
    const hiddenVersion = task({ emailId: "same", snoozedUntil: new Date("2025-01-06T00:00:00Z") });
    const groups = partitionEmailTasks([activeVersion], [hiddenVersion], now);

    expect(groups.todo).toHaveLength(0);
    expect(groups.snoozed).toHaveLength(1);
    expect(groups.snoozed[0].snoozedUntil).toEqual(hiddenVersion.snoozedUntil);
  });

  it("does not expose permanently deleted mail from either cache", () => {
    const groups = partitionEmailTasks(
      [task({ permanentlyDeleted: true })],
      [task({ emailId: "hidden-deleted", dismissed: true, permanentlyDeleted: true })],
      now,
    );
    expect(Object.values(groups).flat()).toHaveLength(0);
  });

  it("treats a snooze expiring exactly now as To do without mutating inputs", () => {
    const active = [task({ snoozedUntil: now })];
    const groups = partitionEmailTasks(active, [], now);
    expect(groups.todo).toHaveLength(1);
    expect(groups.snoozed).toHaveLength(0);
    expect(active[0].snoozedUntil).toEqual(now);
  });

  it.each([
    new Date(2026, 2, 8, 0, 30), // spring DST transition
    new Date(2026, 10, 1, 0, 30), // fall DST transition
    new Date(2026, 11, 31, 23), // year boundary
  ])("snoozes until the next local midnight across calendar boundaries", (date) => {
    const originalTime = date.getTime();
    const until = new Date(tomorrowSnoozeUntil(date));
    expect(until.getHours()).toBe(0);
    expect(until.getMinutes()).toBe(0);
    expect(until.getTime()).toBeGreaterThan(date.getTime());
    const expected = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    expect(until.getTime()).toBe(expected.getTime());
    expect(date.getTime()).toBe(originalTime);
  });
});
