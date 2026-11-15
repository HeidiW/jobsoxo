// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { JobBillingPanel, type JobBillingData } from "@/components/invoices/job-billing-panel";
import { queryClient } from "@/lib/queryClient";

let billing: JobBillingData;
let status: number;

function mount() {
  return render(<QueryClientProvider client={queryClient}><JobBillingPanel jobId="job-1" /></QueryClientProvider>);
}

describe("JobBillingPanel", () => {
  beforeEach(() => {
    queryClient.clear();
    status = 200;
    billing = {
      contractTotal: 11200, invoicedToDate: 5500, paidToDate: 5500, remaining: 5700,
      scope: [{ section: "Walls", description: "Prep and paint", amount: 5200 }, { section: "Ceilings", description: "Skim and paint", amount: 6000 }],
      invoices: [
        { id: "inv-1", invoiceNumber: "CFP-2026-0007", stage: "deposit", status: "paid", total: 5500, amountPaid: 5500, balance: 0, issueDate: "2026-11-02T00:00:00.000Z", dueDate: "2026-11-16T00:00:00.000Z" },
        { id: "inv-2", invoiceNumber: "CFP-2026-0008", stage: "standalone", status: "sent", total: 300, amountPaid: 0, balance: 300, issueDate: "2026-11-05T00:00:00.000Z", dueDate: "2026-12-05T00:00:00.000Z" },
      ],
    };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(billing, { status })));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows the contract, what's billed and paid, the stage invoices, and the next stages", async () => {
    mount();
    const panel = await screen.findByTestId("job-billing");
    expect(panel).toHaveTextContent("$11,200.00 contract from 2 priced lines");
    expect(screen.getByTestId("stat-invoiced")).toHaveTextContent("$5,500.00");
    expect(screen.getByTestId("stat-remaining")).toHaveTextContent("$5,700.00");
    expect(panel).toHaveTextContent("49% invoiced · 49% paid");
    expect(screen.getByTestId("billing-stage-inv-1")).toHaveTextContent("Deposit");
    // Standard invoices aren't stages, so they stay in the Invoices card.
    expect(screen.queryByTestId("billing-stage-inv-2")).toBeNull();
    // A deposit already exists, so the next moves are progress or final.
    expect(screen.queryByTestId("button-bill-deposit")).toBeNull();
    expect(screen.getByTestId("button-bill-progress")).toHaveAttribute("href", "/invoices/new?jobId=job-1&stage=progress");
    expect(screen.getByTestId("button-bill-final")).toHaveAttribute("href", "/invoices/new?jobId=job-1&stage=final");
  });

  it("offers a deposit first on an unbilled contract and says when it's fully invoiced", async () => {
    billing = { ...billing, invoicedToDate: 0, paidToDate: 0, remaining: 11200, invoices: [] };
    mount();
    expect(await screen.findByTestId("button-bill-deposit")).toHaveAttribute("href", "/invoices/new?jobId=job-1&stage=deposit");
    cleanup(); queryClient.clear();
    billing = { ...billing, invoicedToDate: 11200, paidToDate: 8000, remaining: 0 };
    mount();
    expect(await screen.findByTestId("billing-complete")).toBeInTheDocument();
    expect(screen.queryByTestId("button-bill-final")).toBeNull();
  });

  it("explains when the job has no priced scope, and when billing can't load", async () => {
    billing = { ...billing, contractTotal: 0, scope: [], invoicedToDate: 0, paidToDate: 0, remaining: 0, invoices: [] };
    mount();
    expect(await screen.findByTestId("job-billing")).toHaveTextContent("No priced line items yet");
    expect(screen.queryByTestId("button-bill-progress")).toBeNull();
    cleanup(); queryClient.clear();
    status = 500;
    mount();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Billing couldn’t be loaded"));
  });
});
