// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { LineItemProgress } from "@/components/invoices/line-item-progress";
import { queryClient } from "@/lib/queryClient";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

// jsdom lacks these; Radix Select needs them.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

const items = [
  { id: "li-1", description: "Prep walls", section: "Ground floor", status: "completed", isChangeOrder: false },
  { id: "li-2", description: "Paint ceilings", section: "Ground floor", status: "in_progress", isChangeOrder: false },
  { id: "li-3", description: "Extra coat", section: "First floor", status: "pending", isChangeOrder: true },
] as any[];
let patches: Array<{ url: string; body: Record<string, unknown> }>;
let failPatch: boolean;

function mount() {
  queryClient.setQueryData(["/api/invoices", "inv-1"], { id: "inv-1", lineItems: items });
  return render(<QueryClientProvider client={queryClient}><LineItemProgress invoiceId="inv-1" items={items} /></QueryClientProvider>);
}

describe("LineItemProgress", () => {
  beforeEach(() => {
    queryClient.clear();
    toast.mockReset();
    patches = [];
    failPatch = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patches.push({ url, body });
        return failPatch ? Response.json({ error: "Invoice is locked" }, { status: 400 }) : Response.json({ id: url.split("/").pop(), ...body });
      }
      return Response.json({ id: "inv-1", lineItems: items });
    }));
  });
  afterEach(() => { cleanup(); queryClient.clear(); vi.unstubAllGlobals(); });

  it("shows each item's status, grouped by section, with a summary", () => {
    mount();
    expect(screen.getByTestId("text-line-item-progress")).toHaveTextContent("1 of 3 completed · 1 in progress");
    expect(screen.getByText("Ground floor")).toBeInTheDocument();
    expect(screen.getByText("First floor")).toBeInTheDocument();
    expect(screen.getByTestId("select-status-li-1")).toHaveTextContent("Completed");
    expect(screen.getByTestId("select-status-li-2")).toHaveTextContent("In progress");
    expect(screen.getByTestId("select-status-li-3")).toHaveTextContent("Pending");
    expect(screen.getByTestId("progress-row-li-3")).toHaveTextContent("CO");
    expect(screen.getByText(/doesn't appear on the invoice sent to the client/)).toBeInTheDocument();
  });

  it("saves a new status as soon as it's chosen", async () => {
    mount();
    await userEvent.click(screen.getByTestId("select-status-li-3"));
    await userEvent.click(await screen.findByTestId("status-option-completed"));

    await waitFor(() => expect(patches).toEqual([{ url: "/api/line-items/li-3", body: { status: "completed" } }]));
  });

  it("reverts and explains when the save fails", async () => {
    failPatch = true;
    mount();
    await userEvent.click(screen.getByTestId("select-status-li-3"));
    await userEvent.click(await screen.findByTestId("status-option-in_progress"));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't update status", description: "Invoice is locked" })));
  });

  it("renders nothing for an invoice with no line items", () => {
    queryClient.setQueryData(["/api/invoices", "inv-1"], { id: "inv-1", lineItems: [] });
    const { container } = render(<QueryClientProvider client={queryClient}><LineItemProgress invoiceId="inv-1" items={[]} /></QueryClientProvider>);
    expect(container).toBeEmptyDOMElement();
  });
});
