// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import InvoicePay from "../invoice-pay";
import { queryClient } from "@/lib/queryClient";

let data: Record<string, unknown>;
let checkouts: number;
let verifies: Array<{ sessionId: string }>;

function mount(search = "") {
  window.history.pushState({}, "", `/pay/tok-123${search}`);
  return render(<QueryClientProvider client={queryClient}><InvoicePay /></QueryClientProvider>);
}

describe("InvoicePay", () => {
  beforeEach(() => {
    queryClient.clear();
    checkouts = 0;
    verifies = [];
    data = {
      invoiceNumber: "CFP-2026-0007", balance: "5500.00", total: "5500.00", amountPaid: "0.00", dueDate: "2026-11-16T00:00:00.000Z", status: "sent",
      stage: "deposit", contractTotal: "11200.00", previouslyPaid: null, clientName: "Ramp Contractors", companyName: "Conor Foy Painting",
      companyEmail: "office@example.test", companyPhone: null, stripeEnabled: true, processingAmount: "0.00",
      paymentInstructions: "Bank transfer (ACH) is preferred and carries no fee: use the Pay online link and choose your bank.\nCards are accepted through the same link.\nChecks payable to Conor Foy Painting.",
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/checkout") && init?.method === "POST") { checkouts += 1; return Response.json({ url: "https://checkout.stripe.test/s" }); }
      if (String(url).endsWith("/verify") && init?.method === "POST") {
        verifies.push(JSON.parse(String(init.body)));
        // Stripe confirms the card payment; the next load of the invoice shows it paid.
        data = { ...data, status: "paid", balance: "0.00", amountPaid: "5500.00" };
        return Response.json({ outcome: "paid", applied: "recorded" });
      }
      return Response.json(data);
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("asks for a bank transfer first, lists how to pay, and starts checkout", async () => {
    mount();
    expect(await screen.findByTestId("text-balance")).toHaveTextContent("$5,500.00");
    expect(screen.getByTestId("status-invoice")).toHaveTextContent("Due");
    expect(screen.getByTestId("text-stage-context")).toHaveTextContent("Deposit on a $11,200.00 contract");
    expect(screen.getByTestId("text-ach-preferred")).toHaveTextContent("Bank transfer (ACH) preferred, no fee to you.");
    expect(screen.getByTestId("text-payment-instructions")).toHaveTextContent("Checks payable to Conor Foy Painting.");
    fireEvent.click(screen.getByTestId("button-pay-now"));
    await waitFor(() => expect(checkouts).toBe(1));
  });

  it("shows a bank payment as processing rather than paid until it settles", async () => {
    data = { ...data, processingAmount: "5500.00" };
    mount();
    const status = await screen.findByTestId("status-processing");
    expect(status).toHaveTextContent("$5,500.00 is processing");
    expect(status).toHaveTextContent("about four business days");
    expect(screen.getByTestId("status-invoice")).toHaveTextContent("Processing");
    expect(screen.queryByTestId("button-pay-now")).toBeNull();
  });

  it("treats the return from Checkout as submitted, not settled", async () => {
    mount("?payment=success");
    expect(await screen.findByTestId("status-processing")).toHaveTextContent("Payment on its way");
    expect(screen.queryByTestId("status-paid")).toBeNull();
  });

  it("says paid only when the invoice really is", async () => {
    data = { ...data, status: "paid", balance: "0.00", amountPaid: "5500.00" };
    mount();
    expect(await screen.findByTestId("status-paid")).toHaveTextContent("All paid");
  });

  it("confirms the outcome with Stripe before showing the invoice when the client returns from Checkout", async () => {
    mount("?payment=success&session_id=cs_test_123");
    expect(await screen.findByTestId("status-paid")).toBeInTheDocument();
    expect(verifies).toEqual([{ sessionId: "cs_test_123" }]);
    expect(screen.getByTestId("status-invoice")).toHaveTextContent("Paid");
  });

  it("still shows processing on return when the verify call can't be made", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/verify") && init?.method === "POST") throw new Error("offline");
      return Response.json(data);
    }));
    mount("?payment=success&session_id=cs_test_456");
    expect(await screen.findByTestId("status-processing")).toHaveTextContent("Your payment has been submitted.");
  });
});
