// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { SendsToPanel } from "@/pages/invoice-detail";
import { queryClient } from "@/lib/queryClient";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

// jsdom has no ResizeObserver; Radix checkboxes measure with it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const client = { id: "client-1", name: "Northline", email: "main@northline.test", additionalEmails: ["ap@northline.test", "pm@northline.test"] };
let invoicePatches: Array<Record<string, unknown>>;
let clientPatches: Array<Record<string, unknown>>;
let failPatch: boolean;

function invoice(overrides: Record<string, unknown> = {}) {
  return { id: "inv-1", status: "sent", client, recipientEmails: ["main@northline.test", "ap@northline.test"], ...overrides } as any;
}

function mount(data = invoice()) {
  queryClient.setQueryData(["/api/invoices", data.id], data);
  return render(<QueryClientProvider client={queryClient}><SendsToPanel invoice={data} /></QueryClientProvider>);
}

describe("SendsToPanel", () => {
  beforeEach(() => {
    queryClient.clear();
    toast.mockReset();
    invoicePatches = [];
    clientPatches = [];
    failPatch = false;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (path === "/api/invoices/inv-1" && init?.method === "PATCH") {
        invoicePatches.push(body);
        return failPatch ? Response.json({ error: "Paid invoices cannot be edited" }, { status: 400 }) : Response.json({ ...invoice(), ...body });
      }
      if (path === "/api/clients/client-1" && init?.method === "PATCH") {
        clientPatches.push(body);
        return Response.json({ ...client, ...body });
      }
      return Response.json(invoice());
    }));
  });
  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  it("shows which of the client's addresses are ticked", () => {
    mount();
    expect(screen.getByTestId("checkbox-recipient-main@northline.test")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("checkbox-recipient-ap@northline.test")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("checkbox-recipient-pm@northline.test")).toHaveAttribute("aria-checked", "false");
  });

  it("ticks only the primary email on older invoices", () => {
    mount(invoice({ recipientEmails: null }));
    expect(screen.getByTestId("checkbox-recipient-main@northline.test")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("checkbox-recipient-ap@northline.test")).toHaveAttribute("aria-checked", "false");
  });

  it("saves each change straight away", async () => {
    mount();
    await userEvent.click(screen.getByTestId("checkbox-recipient-pm@northline.test"));

    await waitFor(() => expect(invoicePatches).toEqual([{ recipientEmails: ["main@northline.test", "ap@northline.test", "pm@northline.test"] }]));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Recipients updated" }));
  });

  it("won't remove the last recipient", async () => {
    mount(invoice({ recipientEmails: ["main@northline.test"] }));
    await userEvent.click(screen.getByTestId("checkbox-recipient-main@northline.test"));

    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Keep at least one recipient" }));
    expect(invoicePatches).toHaveLength(0);
  });

  it("adds a new address to the client and to this invoice", async () => {
    mount();
    fireEvent.change(screen.getByTestId("input-add-recipient"), { target: { value: "billing@northline.test" } });
    await userEvent.click(screen.getByTestId("button-add-recipient"));

    await waitFor(() => expect(clientPatches).toEqual([{ additionalEmails: ["ap@northline.test", "pm@northline.test", "billing@northline.test"] }]));
    await waitFor(() => expect(invoicePatches).toEqual([{ recipientEmails: ["main@northline.test", "ap@northline.test", "billing@northline.test"] }]));
  });

  it("shows the server's reason when saving fails", async () => {
    failPatch = true;
    mount();
    await userEvent.click(screen.getByTestId("checkbox-recipient-pm@northline.test"));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't update recipients", description: "Paid invoices cannot be edited",
    })));
  });

  it("is read-only on paid invoices", () => {
    mount(invoice({ status: "paid" }));
    expect(screen.getByTestId("text-sends-to")).toHaveTextContent("main@northline.test, ap@northline.test");
    expect(screen.queryByTestId("input-add-recipient")).not.toBeInTheDocument();
  });
});
