// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { EmailDeliveryPanel } from "@/components/invoices/email-delivery-panel";
import { queryClient } from "@/lib/queryClient";

let rows: Array<Record<string, unknown>>;
const row = (overrides: Record<string, unknown>) => ({
  id: "d1", invoiceId: "inv-1", kind: "invoice", recipients: ["ap@client.example"], providerId: "re_1",
  status: "delivered", detail: null, providerReason: null, createdAt: "2026-11-08T15:00:00Z", updatedAt: "2026-11-08T15:00:05Z", lastCheckedAt: null,
  ...overrides,
});

function mount() {
  return render(<QueryClientProvider client={queryClient}><EmailDeliveryPanel invoiceId="inv-1" /></QueryClientProvider>);
}

describe("EmailDeliveryPanel", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(rows)));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows nothing before any email has been sent", async () => {
    rows = [];
    const { container } = mount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each email with who it went to and whether it arrived", async () => {
    rows = [
      row({ id: "d2", kind: "reminder", status: "sent" }),
      row({ id: "d1", kind: "invoice", status: "delivered" }),
    ];
    mount();
    expect(await screen.findByTestId("delivery-d1")).toHaveTextContent("Invoice");
    expect(screen.getByTestId("delivery-d1")).toHaveTextContent("to ap@client.example");
    expect(screen.getByTestId("delivery-d1")).toHaveTextContent("Delivered");
    expect(screen.getByTestId("delivery-d2")).toHaveTextContent("Payment reminder");
    expect(screen.getByTestId("delivery-d2")).toHaveTextContent("Sending");
    expect(screen.getByTestId("delivery-d2")).toHaveTextContent("waiting for the client's mail server");
    expect(screen.queryByTestId("alert-invoice-email-problem")).not.toBeInTheDocument();
  });

  it("warns at the top when the latest invoice email bounced, with the reason", async () => {
    rows = [row({ status: "bounced", detail: "That email address doesn't exist. Check the spelling with the client, fix it on the client, and send again." })];
    mount();
    const alert = await screen.findByTestId("alert-invoice-email-problem");
    expect(alert).toHaveTextContent("The client didn't get this invoice by email (bounced)");
    expect(alert).toHaveTextContent("doesn't exist");
    expect(alert).toHaveTextContent("Sent to ap@client.example");
    expect(screen.getByTestId("text-delivery-detail")).toHaveTextContent("doesn't exist");
  });

  it("doesn't raise the alarm for a reminder problem when the invoice itself arrived", async () => {
    rows = [row({ id: "d2", kind: "reminder", status: "failed", detail: "Resend couldn't send it" }), row({ id: "d1" })];
    mount();
    expect(await screen.findByTestId("delivery-d2")).toHaveTextContent("Not sent");
    expect(screen.queryByTestId("alert-invoice-email-problem")).not.toBeInTheDocument();
  });
});
