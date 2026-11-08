// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Router } from "wouter";
import PayrollArea from "@/components/payroll-area";

const mockAuth = vi.hoisted(() => ({ isAdmin: true }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { isAdmin: mockAuth.isAdmin } }),
}));
vi.mock("@/pages/payroll", () => ({ default: () => <div data-testid="payroll-home">Payroll workspace</div> }));
vi.mock("@/pages/payroll-worksheet", () => ({ default: () => <div data-testid="worksheet-page">Worksheet fields</div> }));

// Section tabs (including the admin Worksheet tab) live on the Payroll page;
// this wrapper only routes between the page and the worksheet.
describe("PayrollArea routing and permissions", () => {
  afterEach(() => {
    mockAuth.isAdmin = true;
    window.history.replaceState({}, "", "/");
  });

  it("shows admins the worksheet and preserves employee/worksheet route context", () => {
    window.history.replaceState({}, "", "/payroll/worksheet?employeeId=crew-8&worksheetId=record-4");
    render(<Router><PayrollArea /></Router>);

    expect(screen.getByTestId("worksheet-page")).toBeInTheDocument();
    expect(screen.queryByTestId("payroll-home")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Payroll sections" })).not.toBeInTheDocument();
    expect(window.location.search).toContain("employeeId=crew-8");
    expect(window.location.search).toContain("worksheetId=record-4");
  });

  it("redirects non-admin worksheet access back to payroll", async () => {
    mockAuth.isAdmin = false;
    window.history.replaceState({}, "", "/payroll/worksheet?employeeId=crew-8");
    render(<Router><PayrollArea /></Router>);

    expect(screen.queryByTestId("worksheet-page")).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/payroll"));
    expect(await screen.findByTestId("payroll-home")).toBeInTheDocument();
  });
});
