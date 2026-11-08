// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Payroll from "../payroll";
import { TooltipProvider } from "@/components/ui/tooltip";

let mockUser: { id: string; isAdmin: boolean } | null = { id: "admin", isAdmin: true };
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mockUser }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/payroll/gusto-bank-view", () => ({ default: () => <section aria-label="Independent bank balance view" /> }));
vi.mock("@/components/payroll/gusto-payroll-workspace", () => ({ default: () => <section aria-label="Gusto payroll workspace" /> }));

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

let client: QueryClient;
let gustoStatus: Record<string, unknown>;
let readiness: Record<string, unknown>;
const scrollIntoView = vi.fn();

function show() {
  client = new QueryClient({
    defaultOptions: { queries: {
      retry: false,
      queryFn: async ({ queryKey }) => {
        if (queryKey[0] === "/api/gusto/status") return gustoStatus;
        if (queryKey[0] === "/api/gusto/employees/readiness") return readiness;
        return queryKey[0] === "/api/settings" ? {} : [];
      },
    } },
  });
  render(<QueryClientProvider client={client}><TooltipProvider><Payroll /></TooltipProvider></QueryClientProvider>);
}

describe("Payroll header: status and next step", () => {
  beforeEach(() => {
    mockUser = { id: "admin", isAdmin: true };
    gustoStatus = { configured: false };
    readiness = { employees: [] };
    Element.prototype.scrollIntoView = scrollIntoView;
    scrollIntoView.mockReset();
  });
  afterEach(() => { cleanup(); client?.clear(); });

  it("tells an admin to set up Gusto first and points them at the workspace", async () => {
    show();
    const button = await screen.findByTestId("button-next-step");
    await waitFor(() => expect(button).toHaveTextContent("Set up Gusto payroll"));
    expect(screen.getByTestId("status-gusto")).toHaveAttribute("data-state", "todo");
    expect(screen.getByTestId("status-gusto")).toHaveTextContent("Not connected");
    expect(screen.getByTestId("status-period")).toHaveTextContent("No pay run prepared");

    fireEvent.click(button);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(screen.getByTestId("tab-payroll")).toHaveAttribute("aria-pressed", "true");
  });

  it("asks for employees once Gusto is set up, then offers to prepare a pay run", async () => {
    gustoStatus = { companyId: "c1", onboardingComplete: true, fundingAccount: { status: "verified" } };
    show();
    await waitFor(() => expect(screen.getByTestId("button-next-step")).toHaveTextContent("Add employees"));
    expect(screen.getByTestId("status-gusto")).toHaveAttribute("data-state", "done");
    expect(screen.getByTestId("status-employees")).toHaveTextContent("None added");

    fireEvent.click(screen.getByTestId("button-next-step"));
    expect(await screen.findByTestId("input-employee-first-name")).toBeInTheDocument();
  });

  it("offers Prepare pay run when everyone is ready", async () => {
    gustoStatus = { companyId: "c1", onboardingComplete: true, fundingAccount: { status: "verified" } };
    readiness = { employees: [{ id: "e1", ready: true }, { id: "e2", ready: true }] };
    show();
    await waitFor(() => expect(screen.getByTestId("button-next-step")).toHaveTextContent("Prepare pay run"));
    expect(screen.getByTestId("status-employees")).toHaveTextContent("2 of 2");

    fireEvent.click(screen.getByTestId("button-next-step"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("gives members Log hours as the only primary action and no Gusto status", async () => {
    mockUser = { id: "member", isAdmin: false };
    show();
    const button = await screen.findByTestId("button-next-step");
    expect(button).toHaveTextContent("Log hours");
    expect(screen.queryByTestId("button-log-hours")).toBeNull();
    expect(screen.queryByTestId("status-gusto")).toBeNull();
    expect(screen.getByTestId("status-period")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-worksheet")).toBeNull();
  });

  it("uses plain-language tabs with the worksheet as a tab for admins", async () => {
    show();
    await screen.findByTestId("button-next-step");
    const labels = ["Run payroll", "Employees", "Hours", "Text messages", "History", "Bank", "Payroll settings"];
    for (const label of labels) expect(screen.getByRole("button", { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    expect(screen.getByTestId("tab-worksheet")).toHaveAttribute("href", "/payroll/worksheet");
  });
});
