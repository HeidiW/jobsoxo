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

describe("PayrollArea tabs and permissions", () => {
  afterEach(() => {
    mockAuth.isAdmin = true;
    window.history.replaceState({}, "", "/");
  });

  it("shows the admin worksheet tab and preserves employee/worksheet route context", () => {
    window.history.replaceState({}, "", "/payroll/worksheet?employeeId=crew-8&worksheetId=record-4");
    render(<Router><PayrollArea /></Router>);

    expect(screen.getByRole("link", { name: /Gusto worksheet/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("worksheet-page")).toBeInTheDocument();
    expect(window.location.search).toContain("employeeId=crew-8");
    expect(window.location.search).toContain("worksheetId=record-4");
  });

  it("keeps the payroll tab available and redirects non-admin worksheet access", async () => {
    mockAuth.isAdmin = false;
    window.history.replaceState({}, "", "/payroll/worksheet?employeeId=crew-8");
    render(<Router><PayrollArea /></Router>);

    expect(screen.getByRole("link", { name: "Payroll" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Gusto worksheet/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("worksheet-page")).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/payroll"));
  });
});
