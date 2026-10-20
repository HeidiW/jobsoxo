// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import type { InboxTask } from "@shared/schema";
import GmailTodos from "@/pages/gmail-todos";
import { queryClient } from "@/lib/queryClient";

function makeResponse(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
}

function email(emailId: string, overrides: Partial<InboxTask> = {}): InboxTask {
  return {
    id: emailId,
    userId: "current-user",
    emailId,
    subject: `Subject ${emailId}`,
    sender: "Morgan Lee",
    senderEmail: "morgan@example.test",
    snippet: "A message that needs a quick look.",
    receivedAt: new Date("2022-06-01T09:30:00Z"),
    isRead: true,
    isDone: false,
    dismissed: false,
    snoozedUntil: null,
    permanentlyDeleted: false,
    createdAt: new Date("2022-06-01T09:30:00Z"),
    ...overrides,
  } as InboxTask;
}

describe("Gmail Inbox status tabs", () => {
  const olderPending = email("older-pending");
  const expiredSnooze = email("expired-snooze", { snoozedUntil: new Date("2020-01-01T00:00:00Z") });
  const completed = email("completed", { isDone: true });
  const futureSnooze = email("future-snooze", { snoozedUntil: new Date("2099-01-01T00:00:00Z") });
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient.clear();
    queryClient.setQueryData(["/api/inbox/status"], { connected: true, email: "morgan@example.test" });
    queryClient.setQueryData(["/api/inbox/tasks"], [olderPending, expiredSnooze, completed]);
    queryClient.setQueryData(["/api/inbox/tasks/hidden"], [futureSnooze]);
    queryClient.setQueryData(["/api/inbox/last-sync"], { lastSyncedAt: null });
    queryClient.setQueryData(["/api/clients"], []);
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/inbox/status") return makeResponse({ connected: true, email: "morgan@example.test" });
      if (url === "/api/inbox/tasks") return makeResponse([olderPending, expiredSnooze, completed]);
      if (url === "/api/inbox/tasks/hidden") return makeResponse([futureSnooze]);
      if (url === "/api/inbox/last-sync") return makeResponse({ lastSyncedAt: null });
      if (url === "/api/clients") return makeResponse([]);
      if (url.endsWith("/future-snooze/restore")) return makeResponse({ ...futureSnooze, snoozedUntil: null });
      if (url.endsWith("/older-pending/done")) return makeResponse({ ...olderPending, isDone: true });
      if (url.endsWith("/older-pending/snooze")) {
        return makeResponse({ ...olderPending, snoozedUntil: new Date("2099-01-01T00:00:00Z") });
      }
      return makeResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  function renderInbox() {
    return render(
      <QueryClientProvider client={queryClient}>
        <Router><GmailTodos embedded /></Router>
      </QueryClientProvider>,
    );
  }

  it("keeps older and expired-snooze mail in To do while separating future snoozes and completed mail", async () => {
    renderInbox();

    expect(await screen.findByTestId("task-row-older-pending")).toBeInTheDocument();
    expect(screen.getByTestId("task-row-expired-snooze")).toBeInTheDocument();
    expect(screen.queryByTestId("task-row-future-snooze")).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-row-completed")).not.toBeInTheDocument();
    expect(screen.getByTestId("filter-status-todo")).toHaveTextContent("2");
    expect(screen.getByTestId("filter-status-snoozed")).toHaveTextContent("1");
    expect(screen.getByTestId("filter-status-done")).toHaveTextContent("1");

    fireEvent.click(screen.getByTestId("filter-status-snoozed"));
    expect(screen.getByTestId("task-row-future-snooze")).toBeInTheDocument();
    expect(screen.queryByTestId("task-row-expired-snooze")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("filter-status-done"));
    expect(screen.getByTestId("task-row-completed")).toBeInTheDocument();
  });

  it("sends Snooze through the real user-scoped endpoint and makes the task available under Snoozed", async () => {
    renderInbox();

    fireEvent.click(await screen.findByTestId("button-snooze-older-pending"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/inbox/tasks/older-pending/snooze",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    await waitFor(() => {
      expect(queryClient.getQueryData<InboxTask[]>(["/api/inbox/tasks/hidden"]))
        .toEqual(expect.arrayContaining([expect.objectContaining({ emailId: "older-pending" })]));
    });
  });

  it("persists completion through the done endpoint rather than treating dismissal as completion", async () => {
    renderInbox();

    fireEvent.click(await screen.findByTestId("checkbox-toggle-older-pending"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/inbox/tasks/older-pending/done",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ isDone: true }) }),
      );
    });
    await waitFor(() => {
      expect(queryClient.getQueryData<InboxTask[]>(["/api/inbox/tasks"]))
        .toEqual(expect.arrayContaining([expect.objectContaining({ emailId: "older-pending", isDone: true })]));
    });
  });

  it("keeps a task in To do when completion fails", async () => {
    const originalFetch = fetchMock.getMockImplementation()! as typeof fetch;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/older-pending/done")
        ? new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 })
        : originalFetch(input, init),
    );
    renderInbox();
    fireEvent.click(await screen.findByTestId("checkbox-toggle-older-pending"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/done"))).toBe(true));
    await waitFor(() => expect(screen.getByTestId("checkbox-toggle-older-pending")).not.toBeDisabled());
    expect(screen.getByTestId("task-row-older-pending")).toBeInTheDocument();
    expect(screen.getByTestId("filter-status-done")).toHaveTextContent("1");
  });

  it("keeps a failed snooze visible instead of claiming it was saved", async () => {
    const originalFetch = fetchMock.getMockImplementation()! as typeof fetch;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/older-pending/snooze")
        ? new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 })
        : originalFetch(input, init),
    );
    renderInbox();
    fireEvent.click(await screen.findByTestId("button-snooze-older-pending"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/snooze"))).toBe(true));
    await waitFor(() => expect(screen.getByTestId("button-snooze-older-pending")).not.toBeDisabled());
    expect(screen.getByTestId("task-row-older-pending")).toBeInTheDocument();
    expect(screen.getByTestId("filter-status-snoozed")).toHaveTextContent("1");
  });

  it("opens a real Gmail link rather than a nonexistent client detail route", async () => {
    renderInbox();
    const subject = await screen.findByTestId("task-subject-older-pending");
    expect(subject.closest("a")).toHaveAttribute("href", "https://mail.google.com/mail/u/0/#all/older-pending");
    expect(subject.closest("a")).toHaveAttribute("target", "_blank");
  });
});
