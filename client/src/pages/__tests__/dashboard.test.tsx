// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import Dashboard from "@/pages/dashboard";
import { queryClient } from "@/lib/queryClient";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/components/job-form", () => ({
  default: () => <div data-testid="dashboard-job-form">Production job form</div>,
}));

const dashboardData = {
  outstanding: { total: 6850, invoiceCount: 2, clientCount: 2, overdue: 1200, dueSoon: 800, draft: 450 },
  collectedThisMonth: { amount: 3200, momDeltaPct: 8 },
  activeJobs: { count: 1, crews: 0, hoursToday: 0 },
  needsAttention: [{
    invoiceId: "invoice-1",
    invoiceNumber: "INV-1042",
    client: "Northline Builders",
    project: "Maple Street",
    reason: "overdue" as const,
    detail: "4 days overdue",
    balance: 1200,
    daysOverdue: 4,
  }],
  week: [
    { date: "2025-01-06", weekday: "MON", dayNum: 6, isToday: true, jobs: [{ jobId: "job-1", label: "Maple Street", crewSize: 0, color: "#4E7D3A" }] },
    { date: "2025-01-07", weekday: "TUE", dayNum: 7, isToday: false, jobs: [] },
    { date: "2025-01-08", weekday: "WED", dayNum: 8, isToday: false, jobs: [] },
    { date: "2025-01-09", weekday: "THU", dayNum: 9, isToday: false, jobs: [] },
    { date: "2025-01-10", weekday: "FRI", dayNum: 10, isToday: false, jobs: [] },
  ],
  greeting: { firstName: "Rae", timeOfDay: "morning" as const },
};

const jobs = [{
  id: "job-1",
  clientId: "client-1",
  title: "Maple Street",
  status: "in_progress",
  startDate: "2025-01-06",
  client: { id: "client-1", name: "Northline Builders" },
}];
let reminderPayload: { success?: boolean } = { success: true };

function renderDashboard() {
  return render(
    <QueryClientProvider client={queryClient}>
      <Router><Dashboard /></Router>
    </QueryClientProvider>,
  );
}

describe("Dashboard interactions", () => {
  beforeEach(() => {
    queryClient.clear();
    toastMock.mockClear();
    reminderPayload = { success: true };
    queryClient.setQueryData(["/api/dashboard"], dashboardData);
    queryClient.setQueryData(["/api/jobs"], jobs);
    queryClient.setQueryData(["/api/jobs", "job-1", "documents"], []);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST" && url.endsWith("/api/invoices/invoice-1/remind")) {
        return new Response(JSON.stringify(reminderPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/dashboard") return new Response(JSON.stringify(dashboardData));
      if (url === "/api/jobs") return new Response(JSON.stringify(jobs));
      return new Response(JSON.stringify([]));
    }));
  });

  it("shows Sent only when the individual reminder endpoint confirms success", async () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Send reminder to Northline Builders" }));
    expect(await screen.findByRole("button", { name: "Reminder sent to Northline Builders" })).toHaveTextContent("Sent");
  });

  it("keeps reminder feedback retryable when dispatch is not confirmed", async () => {
    reminderPayload = { success: false };
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "Send reminder to Northline Builders" }));
    expect(await screen.findByRole("button", { name: "Retry reminder for Northline Builders" })).toHaveTextContent("Retry");
    expect(await screen.findByRole("alert")).toHaveTextContent("Reminder wasn’t sent");
  });

  it("opens the new job dialog with the existing job form mounted", async () => {
    renderDashboard();
    fireEvent.click(screen.getByRole("button", { name: "New job" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByTestId("dashboard-job-form")).toHaveTextContent("Production job form");
  });
});
