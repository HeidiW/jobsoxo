// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Invoices from "../invoices";
import { queryClient } from "@/lib/queryClient";

const { navigate, toast } = vi.hoisted(() => ({ navigate: vi.fn(), toast: vi.fn() }));
vi.mock("wouter", async (original) => ({
  ...await original<typeof import("wouter")>(),
  useLocation: () => ["/invoices", navigate],
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const base = {
  id: "sent", invoiceNumber: "JOX-100", status: "sent", total: "1500.57",
  balance: "1500.57", amountPaid: "0", issueDate: "2026-10-01", dueDate: "2026-11-30",
  client: { id: "client-1", name: "Northline Construction" },
  job: { id: "job-1", title: "Hotel restoration" }, paymentDate: null,
  workProgress: { pending: 1, in_progress: 1, completed: 1, total: 3 },
};
const initialRecords = [
  base,
  { ...base, id: "draft", invoiceNumber: "JOX-101", status: "draft", total: "300", balance: "300" },
  { ...base, id: "partial", invoiceNumber: "JOX-102", status: "partial", total: "700", balance: "250" },
  { ...base, id: "overdue", invoiceNumber: "JOX-103", status: "overdue", total: "900", balance: "900" },
  { ...base, id: "paid", invoiceNumber: "JOX-104", status: "paid", total: "500", balance: "0" },
];
let records = initialRecords;
let failure: boolean;
let fetchMock: ReturnType<typeof vi.fn>;

function mount() {
  return render(<QueryClientProvider client={queryClient}><Invoices /></QueryClientProvider>);
}
async function actions(id = "sent") {
  await userEvent.click(await screen.findByTestId(`button-invoice-actions-${id}`));
}

describe("Invoices list redesign", () => {
  beforeEach(() => {
    queryClient.clear(); navigate.mockReset(); toast.mockReset();
    records = structuredClone(initialRecords); failure = false;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/invoices" && failure) return Response.json({ error: "Unavailable" }, { status: 503 });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (init?.method && init.method !== "GET") return Response.json({ ok: true });
      if (path === "/api/invoices") return Response.json(records);
      if (path === "/api/collections") return Response.json([]);
      if (path === "/api/plaid/transactions") return Response.json({ connected: false, ready: false, transactions: [] });
      return Response.json({ error: "Not found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { queryClient.clear(); vi.unstubAllGlobals(); });

  it("preserves cents, displays separate client/job and balance columns, and filters by status", async () => {
    mount();
    const row = await screen.findByTestId("row-invoice-sent");
    const header = screen.getByTestId("invoices-table-header");
    const grid = (element: HTMLElement) => [...element.classList].find((value) => value.startsWith("grid-cols-"));
    expect(grid(header)).toEqual(grid(row));
    expect(header).toHaveClass("border-2");
    expect(header.children).toHaveLength(9);
    expect(header.lastElementChild).not.toHaveClass("sr-only");
    expect(header.lastElementChild).toHaveClass("relative");
    expect(row).toHaveTextContent("Northline Construction");
    expect(row).toHaveTextContent("Hotel restoration");
    expect(within(row).getByTestId("work-progress-sent")).toHaveTextContent("1/3 done · 1 in progress");
    expect(within(row).getByTestId("link-invoice-sent")).toHaveAttribute("href", "/invoices/sent");
    // Drafts reopen in the builder, where they autosave.
    expect(screen.getByTestId("link-invoice-draft")).toHaveAttribute("href", "/invoices/new?draft=draft");
    expect(within(row).getAllByText("$1,500.57")).toHaveLength(2);
    expect(screen.getByTestId("stat-outstanding")).toHaveTextContent("$2,650.57");
    expect(screen.getByTestId("stat-overdue")).toHaveTextContent("$900.00");
    await userEvent.click(screen.getByRole("button", { name: /^Partly paid/ }));
    expect(screen.getByTestId("row-invoice-partial")).toBeInTheDocument();
    expect(screen.queryByTestId("row-invoice-sent")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Paid/ }));
    expect(screen.getByTestId("row-invoice-paid")).toBeInTheDocument();
    expect(screen.queryByTestId("row-invoice-partial")).not.toBeInTheDocument();
  });

  it("resets pagination when searching and supports invoice, client and job search", async () => {
    records = Array.from({ length: 14 }, (_, index) => ({ ...base, id: `item-${index}`, invoiceNumber: `JOX-${index}` }));
    mount(); await screen.findByTestId("row-invoice-item-0");
    expect(screen.queryByTestId("row-invoice-item-13")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-next-page"));
    expect(await screen.findByTestId("row-invoice-item-13")).toBeInTheDocument();
    const input = screen.getByTestId("input-search-invoices");
    fireEvent.change(input, { target: { value: "  JOX-0  " } });
    expect(screen.getByTestId("row-invoice-item-0")).toBeInTheDocument();
    expect(screen.queryByTestId("row-invoice-item-13")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "hotel restoration" } });
    expect(screen.getByTestId("row-invoice-item-0")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "northline" } });
    expect(screen.getByTestId("row-invoice-item-0")).toBeInTheDocument();
  });

  it("keeps view, PDF, partial payment and send actions and isolates menus from row navigation", async () => {
    mount(); await actions();
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("button-view-invoice-sent")).toHaveAttribute("href", "/invoices/sent");
    expect(screen.getByTestId("button-download-invoice-sent")).toHaveAttribute("href", "/invoices/sent?autoDownload=1");
    expect(screen.getByTestId("button-record-payment-sent")).toHaveAttribute("href", "/invoices/sent/payment");
    await userEvent.click(screen.getByTestId("button-send-invoice-sent"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/invoices/sent/send", expect.objectContaining({ method: "POST" })));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("supports keyboard row navigation without activating it from the menu button", async () => {
    mount();
    const row = await screen.findByTestId("row-invoice-sent");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith("/invoices/sent");
    navigate.mockReset();
    fireEvent.keyDown(screen.getByTestId("button-invoice-actions-sent"), { key: "Enter" });
    expect(navigate).not.toHaveBeenCalled();
    fireEvent.keyDown(row, { key: " " });
    expect(navigate).toHaveBeenCalledWith("/invoices/sent");
  });

  it("retains payment methods, date, cancellation and the original payment endpoint", async () => {
    mount(); await actions();
    await userEvent.click(screen.getByTestId("button-mark-paid-sent"));
    expect(screen.getByRole("dialog")).toHaveTextContent("$1,500.57");
    for (const method of ["cash", "check", "bank_transfer", "credit_card"]) {
      expect(screen.getByTestId(`button-pay-method-${method}`)).toBeInTheDocument();
    }
    await userEvent.click(screen.getByTestId("button-cancel-quick-pay"));
    expect(fetchMock.mock.calls.some(([path]) => String(path).endsWith("/mark-paid"))).toBe(false);
    await actions(); await userEvent.click(screen.getByTestId("button-mark-paid-sent"));
    await userEvent.click(screen.getByTestId("button-pay-method-check"));
    fireEvent.change(screen.getByTestId("input-quick-pay-date"), { target: { value: "2026-10-19" } });
    await userEvent.click(screen.getByTestId("button-confirm-quick-pay"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/invoices/sent/mark-paid", expect.objectContaining({
      method: "POST", body: JSON.stringify({ paymentMethod: "check", paymentDate: new Date("2026-10-19").toISOString() }),
    })));
  });

  it("requires confirmation to delete and hides send/payment actions for paid invoices", async () => {
    mount(); await actions("paid");
    expect(screen.queryByTestId("button-send-invoice-paid")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-mark-paid-paid")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-delete-invoice-paid"));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("all its line items");
    await userEvent.click(screen.getByTestId("button-cancel-delete-invoice"));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await actions("paid"); await userEvent.click(screen.getByTestId("button-delete-invoice-paid"));
    await userEvent.click(screen.getByTestId("button-confirm-delete-invoice"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/invoices/paid", expect.objectContaining({ method: "DELETE" })));
  });

  it("keeps Collections and reconciliation accessible without fetching bank data until opened", async () => {
    mount(); await screen.findByTestId("row-invoice-sent");
    expect(fetchMock.mock.calls.some(([path]) => path === "/api/plaid/transactions")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: /^Collections/ }));
    expect(await screen.findByText("No overdue invoices")).toBeInTheDocument();
    expect(screen.getByTestId("button-process-reminders")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Reconcile/ }));
    expect(await screen.findByTestId("reconcile-no-account")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Connect a bank account/ })).toHaveAttribute("href", "/settings");
  });

  it("shows a real error rather than an empty list or zero financial totals, and retries", async () => {
    failure = true; mount();
    await screen.findByRole("heading", { name: /Invoices didn.t load/ });
    expect(screen.queryByText("No invoices yet")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stat-outstanding")?.textContent).not.toContain("$0.00");
    failure = false;
    await userEvent.click(screen.getByRole("button", { name: /Retry|Try again/ }));
    expect(await screen.findByTestId("row-invoice-sent")).toBeInTheDocument();
  });
});
