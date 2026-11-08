// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CompanySetupGate } from "@/components/company-setup-gate";
import { queryClient } from "@/lib/queryClient";

let mockUser = { id: "u1", username: "owner@example.com", isAdmin: true };
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mockUser }) }));

const complete = {
  companyName: "Northstar Finish Co.",
  companyEmail: "office@example.test",
  companyPhone: "(212) 555-0100",
  companyAddress: "18 Orchard Street",
  taxRate: "0",
  invoicePrefix: "INV",
  invoiceTerms: "Due within 30 days.",
};
const incomplete = { ...complete, companyName: null, companyAddress: "" };

function renderAt(path: string, settings: Record<string, unknown>) {
  queryClient.setQueryData(["/api/settings"], settings);
  const location = memoryLocation({ path, record: true });
  render(
    <QueryClientProvider client={queryClient}>
      <Router hook={location.hook}>
        <CompanySetupGate />
      </Router>
    </QueryClientProvider>,
  );
  return location;
}

describe("CompanySetupGate", () => {
  beforeEach(() => {
    queryClient.clear();
    mockUser = { id: "u1", username: "owner@example.com", isAdmin: true };
  });
  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it("sends an admin to Settings until setup is complete", async () => {
    const location = renderAt("/invoices", incomplete);
    await waitFor(() => expect(location.history.at(-1)).toBe("/settings"));
    expect(screen.queryByTestId("banner-setup-pending")).not.toBeInTheDocument();
  });

  it("leaves an admin where they are once setup is complete", async () => {
    const location = renderAt("/invoices", complete);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(location.history).toEqual(["/invoices"]);
  });

  it("lets members keep working with a banner", async () => {
    mockUser = { id: "u2", username: "crew@example.com", isAdmin: false };
    const location = renderAt("/jobs", incomplete);

    expect(await screen.findByTestId("banner-setup-pending")).toHaveTextContent("An admin needs to fill in the company details");
    expect(location.history).toEqual(["/jobs"]);
  });

  it("shows nothing to members once setup is complete", () => {
    mockUser = { id: "u2", username: "crew@example.com", isAdmin: false };
    renderAt("/jobs", complete);
    expect(screen.queryByTestId("banner-setup-pending")).not.toBeInTheDocument();
  });
});
