// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import GmailTodos from "@/pages/gmail-todos";
import { queryClient } from "@/lib/queryClient";
import type { InboxTask } from "@shared/schema";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOkResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeTask(overrides: Partial<InboxTask>): InboxTask {
  return {
    id: "id-default",
    userId: "user-1",
    emailId: "email-x",
    subject: "Test Email",
    sender: "Test Sender",
    senderEmail: "test@example.com",
    snippet: "test snippet",
    receivedAt: new Date(),
    isRead: true,
    isDone: false,
    dismissed: false,
    snoozedUntil: null,
    permanentlyDeleted: false,
    createdAt: new Date(),
    ...overrides,
  } as InboxTask;
}

const taskA = makeTask({
  id: "id-a",
  emailId: "email-a",
  subject: "Restore Target",
  sender: "Client A",
  dismissed: true,
});
const taskB = makeTask({
  id: "id-b",
  emailId: "email-b",
  subject: "Second Dismissed",
  sender: "Client B",
  dismissed: true,
});

// ── Test wrapper ──────────────────────────────────────────────────────────────

function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <GmailTodos />
      </Router>
    </QueryClientProvider>
  );
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("GmailTodos restore flow (UI component)", () => {
  beforeEach(() => {
    queryClient.clear();

    // Pre-seed all query caches so the initial render is correct
    queryClient.setQueryData(["/api/inbox/status"], { connected: true, email: "test@gmail.com" });
    queryClient.setQueryData(["/api/inbox/tasks"], []);
    queryClient.setQueryData(["/api/inbox/tasks/hidden"], [taskA, taskB]);
    queryClient.setQueryData(["/api/inbox/last-sync"], { lastSyncedAt: null });
    queryClient.setQueryData(["/api/clients"], []);

    // Mock ALL fetch calls so background refetches return consistent data.
    // Without this the catch-all {} overwrites status.connected to undefined.
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/inbox/status")
        return Promise.resolve(makeOkResponse({ connected: true, email: "test@gmail.com" }));
      if (url === "/api/inbox/tasks")
        return Promise.resolve(makeOkResponse([]));
      if (url === "/api/inbox/tasks/hidden")
        return Promise.resolve(makeOkResponse([taskA, taskB]));
      if (url === "/api/inbox/last-sync")
        return Promise.resolve(makeOkResponse({ lastSyncedAt: null }));
      if (url === "/api/clients")
        return Promise.resolve(makeOkResponse([]));
      // GET /api/inbox/messages — auto-refresh when allTasks is empty
      if (url === "/api/inbox/messages")
        return Promise.resolve(makeOkResponse([]));
      // PATCH restore
      if (typeof url === "string" && url.includes("/restore"))
        return Promise.resolve(makeOkResponse({ ok: true }));
      return Promise.resolve(makeOkResponse({}));
    }));
  });

  afterEach(() => {
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  // ── Test 1: dismissed panel count drops by 1 ─────────────────────────────

  it("removes the restored email from the dismissed panel and decrements the badge", async () => {
    renderPage();

    const toggleBtn = await screen.findByTestId("button-toggle-hidden-panel");
    expect(screen.getByTestId("badge-dismissed-count")).toHaveTextContent("2");

    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("dismissed-row-email-a")).toBeInTheDocument();
    expect(screen.getByTestId("dismissed-row-email-b")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-restore-email-a"));

    await waitFor(() => {
      expect(screen.queryByTestId("dismissed-row-email-a")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("badge-dismissed-count")).toHaveTextContent("1");
    expect(screen.getByTestId("dismissed-row-email-b")).toBeInTheDocument();
  });

  // ── Test 2: restored email appears in the active task list ───────────────

  it("adds the restored email to the active task list", async () => {
    renderPage();

    await screen.findByTestId("button-toggle-hidden-panel");
    expect(screen.queryByTestId("task-row-email-a")).not.toBeInTheDocument();

    const toggleBtn = screen.getByTestId("button-toggle-hidden-panel");
    fireEvent.click(toggleBtn);
    fireEvent.click(screen.getByTestId("button-restore-email-a"));

    await waitFor(() => {
      expect(screen.getByTestId("task-row-email-a")).toBeInTheDocument();
    });
    expect(screen.getByTestId("task-subject-email-a")).toHaveTextContent("Restore Target");
  });

  // ── Test 3: select-all checkbox reflects the correct count ───────────────

  it("select-all checkbox accurately shows 'All 1 selected' after restoring one of two selected emails", async () => {
    renderPage();

    const toggleBtn = await screen.findByTestId("button-toggle-hidden-panel");
    fireEvent.click(toggleBtn);

    // Select all (2 emails)
    const selectAll = screen.getByTestId("checkbox-select-all-dismissed");
    fireEvent.click(selectAll);

    await waitFor(() => {
      expect(screen.getByText("All 2 selected")).toBeInTheDocument();
    });
    expect(selectAll).toBeChecked();

    // Restore email A — handleRestore removes it from selectedIds immediately,
    // then the cleanup useEffect removes it from dismissedGroup.
    fireEvent.click(screen.getByTestId("button-restore-email-a"));

    // dismissedGroup=[B], selectedIds={B} → allDismissedSelected=true → "All 1 selected"
    await waitFor(() => {
      expect(screen.getByText("All 1 selected")).toBeInTheDocument();
    });
    expect(selectAll).toBeChecked();
  });
});
