// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { username: "crew-lead", isAdmin: true }, logout: vi.fn(), isLoggingOut: false }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

function renderSidebar(path: string) {
  window.history.replaceState({}, "", path);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(["/api/inbox/tasks"], []);
  queryClient.setQueryData(["/api/change-orders"], []);
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>
        <SidebarProvider>
          <AppSidebar />
        </SidebarProvider>
      </Router>
    </QueryClientProvider>,
  );
}

describe("AppSidebar", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it("renders exactly nine main destinations and keeps Settings separate", () => {
    renderSidebar("/");
    const mainMenu = screen.getByText("Main menu").closest('[data-slot="sidebar-group"]');
    expect(mainMenu).not.toBeNull();
    const items = Array.from(mainMenu!.querySelectorAll('a[data-testid^="nav-"]'));
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      "Dashboard", "Clients", "Jobs", "Materials", "Invoices", "Change Orders",
      "Scheduling", "Payroll", "Inbox",
    ]);
    expect(screen.getByText("Settings").closest('[data-slot="sidebar-group"]')).not.toBe(mainMenu);
    expect(screen.queryByTestId("nav-gusto-worksheet")).not.toBeInTheDocument();
  });

  it.each([
    ["/jobs/job-21", "nav-jobs"],
    ["/invoices/new", "nav-invoices"],
    ["/payroll/worksheet?employeeId=crew-8", "nav-payroll"],
  ])("marks the correct parent active for %s", (path, testId) => {
    renderSidebar(path);
    expect(screen.getByTestId(testId)).toHaveAttribute("data-active", "true");
  });
});
