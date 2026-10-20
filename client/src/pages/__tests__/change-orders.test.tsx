// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ChangeOrders from "../change-orders";
import { queryClient } from "@/lib/queryClient";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
const invoice = { id: "invoice-a", invoiceNumber: "INV-1", status: "sent" };
const base = { invoiceId: invoice.id, invoice, job: { id: "job-a", title: "Hotel restoration" }, client: null, reason: "Client requested extra work", createdAt: "2026-10-19T12:00:00Z" };
const initialRecords = [
  { ...base, id: "co-add", description: "Extra plaster", status: "pending", amount: "110.25" },
  { ...base, id: "co-credit", description: "Credit for unused finish", status: "pending", amount: "-10.10" },
  { ...base, id: "co-approved", description: "Approved ceiling", status: "approved", amount: "20.00" },
  { ...base, id: "co-rejected", description: "Rejected trim", status: "rejected", amount: "-2.00" },
  { ...base, id: "co-draft", description: "Draft scope", status: "draft", amount: "3.00" },
  { ...base, id: "co-invoiced", description: "Invoiced scope", status: "invoiced", amount: "5.00" },
];
let records: typeof initialRecords;
let failures: Set<string>;
let saveFailed: boolean;
let deleteFailed: boolean;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
const pointerMethods = ["hasPointerCapture", "setPointerCapture", "releasePointerCapture", "scrollIntoView"];
const descriptors = new Map<string, PropertyDescriptor | undefined>();
function mount() { return render(<QueryClientProvider client={queryClient}><ChangeOrders /></QueryClientProvider>); }
async function ready() { await screen.findByTestId("row-co-co-add"); }
function change(id: string, value: string) { fireEvent.change(screen.getByTestId(id), { target: { value } }); }
function writes(method: string) { return fetchMock.mock.calls.filter(([, init]) => init?.method === method); }
function payload(method: string, index = 0) {
  const body = writes(method).at(index)?.[1]?.body;
  if (typeof body !== "string") throw new Error(`Missing JSON body for ${method}`);
  return JSON.parse(body);
}
async function select(id: string, name: RegExp) {
  await userEvent.click(screen.getByTestId(id));
  await userEvent.click(await screen.findByRole("option", { name }));
}
async function openForm() {
  await userEvent.click(screen.getByTestId("button-new-co"));
  await select("select-co-invoice", /INV-1/);
}
async function openDelete(id = "co-add") {
  await userEvent.click(screen.getByTestId(`button-co-actions-${id}`));
  await userEvent.click(await screen.findByTestId(`button-delete-co-${id}`));
}

describe("Change Orders redesign", () => {
  beforeAll(() => pointerMethods.forEach((method) => {
    descriptors.set(method, Object.getOwnPropertyDescriptor(HTMLElement.prototype, method));
    Object.defineProperty(HTMLElement.prototype, method, { configurable: true, value: method === "hasPointerCapture" ? () => false : () => {} });
  }));
  afterAll(() => pointerMethods.forEach((method) => {
    const descriptor = descriptors.get(method);
    if (descriptor) Object.defineProperty(HTMLElement.prototype, method, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, method);
  }));
  beforeEach(() => {
    queryClient.clear(); toast.mockReset(); records = structuredClone(initialRecords);
    failures = new Set(); saveFailed = false; deleteFailed = false;
    vi.stubGlobal("PointerEvent", MouseEvent);
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (failures.has(path)) return Response.json({ error: "Unavailable" }, { status: 503 });
      if (path === "/api/change-orders" && (!init?.method || init.method === "GET")) return Response.json(records);
      if (path === "/api/invoices") return Response.json([invoice]);
      if (init?.method === "POST" || init?.method === "PATCH") {
        if (saveFailed) return Response.json({ error: "Unable to save scope change" }, { status: 400 });
        const values = JSON.parse(init.body as string);
        const id = init.method === "POST" ? "co-new" : path.split("/").pop();
        const record = { ...base, ...(records.find((item) => item.id === id) ?? {}), ...values, id };
        records = init.method === "POST" ? [...records, record] : records.map((item) => item.id === id ? record : item);
        return Response.json(record);
      }
      if (init?.method === "DELETE") {
        if (deleteFailed) return Response.json({ error: "Unable to delete scope change" }, { status: 500 });
        records = records.filter((item) => item.id !== path.split("/").pop());
        return new Response(null, { status: 204 });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { queryClient.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("renders signed cents, existing statuses, reason and working job/invoice links", async () => {
    mount(); await ready();
    expect(screen.getAllByTestId(/^row-co-/)).toHaveLength(6);
    expect(screen.getByTestId("amount-co-co-add")).toHaveTextContent("+$110.25");
    expect(screen.getByTestId("amount-co-co-credit")).toHaveTextContent("−$10.10");
    expect(screen.getByTestId("stat-co-pending-total")).toHaveTextContent("$100.15");
    const card = within(screen.getByTestId("row-co-co-add"));
    expect(card.getByText(base.reason)).toBeVisible();
    expect(card.getByRole("link", { name: base.job.title })).toHaveAttribute("href", "/jobs/job-a");
    expect(card.getByRole("link", { name: /INV-1/ })).toHaveAttribute("href", "/invoices/invoice-a");
  });

  it("uses the filtered net rather than a global total in the footer", async () => {
    mount(); await ready();
    await userEvent.click(screen.getByTestId("filter-co-invoiced"));
    expect(screen.getAllByTestId(/^row-co-/)).toHaveLength(1);
    expect(screen.getByTestId("row-co-co-invoiced")).toBeVisible();
    expect(screen.getByTestId("text-co-filtered-total")).toHaveTextContent("$5.00");
    await userEvent.click(screen.getByTestId("filter-co-pending"));
    expect(screen.getAllByTestId(/^row-co-/)).toHaveLength(2);
    expect(screen.getByTestId("text-co-filtered-total")).toHaveTextContent("$100.15");
  });

  it("approves additions and declines credits using existing status endpoints", async () => {
    mount(); await ready();
    const invalidation = vi.spyOn(queryClient, "invalidateQueries");
    await userEvent.click(screen.getByTestId("button-mark-approved-co-co-add"));
    await waitFor(() => expect(records.find((record) => record.id === "co-add")?.status).toBe("approved"));
    await waitFor(() => expect(screen.getByTestId("button-decline-co-co-credit")).toBeEnabled());
    await userEvent.click(screen.getByTestId("button-decline-co-co-credit"));
    await waitFor(() => expect(records.find((record) => record.id === "co-credit")?.status).toBe("rejected"));
    expect(payload("PATCH")).toEqual({ status: "approved" });
    expect(payload("PATCH", 1)).toEqual({ status: "rejected" });
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["/api/invoices"] });
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ["/api/dashboard"] });
  });

  it("creates an exact credit and preserves form values after a failed save", async () => {
    mount(); await ready(); await openForm();
    change("input-co-description", "  Credit extra plaster  ");
    change("input-co-amount", "12.34");
    change("input-co-reason", "Unused materials");
    await select("select-co-type", /Credit/);
    saveFailed = true;
    await userEvent.click(screen.getByTestId("button-save-co"));
    await screen.findByTestId("change-order-form-error");
    expect(screen.getByTestId("input-co-amount")).toHaveValue("12.34");
    expect(screen.getByTestId("select-co-invoice")).toHaveTextContent("INV-1");
    saveFailed = false;
    await userEvent.click(screen.getByTestId("button-save-co"));
    await screen.findByTestId("row-co-co-new");
    expect(payload("POST", -1)).toEqual({
      invoiceId: "invoice-a", description: "Credit extra plaster", amount: "-12.34",
      reason: "Unused materials", status: "pending",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("validates required scope and amount while allowing a zero-value draft", async () => {
    mount(); await ready(); await openForm();
    await userEvent.click(screen.getByTestId("button-save-co"));
    expect(await screen.findByText("Describe the scope change.")).toBeVisible();
    expect(writes("POST")).toHaveLength(0);
    change("input-co-description", "Revised specification, no cost");
    change("input-co-amount", "0");
    await select("select-co-status", /^Draft$/);
    await userEvent.click(screen.getByTestId("button-save-co"));
    await screen.findByTestId("row-co-co-new");
    expect(payload("POST")).toMatchObject({ amount: "0.00", status: "draft", reason: null });
  });

  it("keeps deletion explicit, retains the dialog on failure and supports retry", async () => {
    mount(); await ready(); await openDelete();
    await userEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(writes("DELETE")).toHaveLength(0);
    await openDelete();
    deleteFailed = true;
    await userEvent.click(screen.getByTestId("button-confirm-delete-co"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
    expect(screen.getByRole("alertdialog")).toBeVisible();
    expect(screen.getByTestId("row-co-co-add")).toBeInTheDocument();
    deleteFailed = false;
    await userEvent.click(screen.getByTestId("button-confirm-delete-co"));
    await waitFor(() => expect(screen.queryByTestId("row-co-co-add")).not.toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows a recoverable list error rather than a false empty state", async () => {
    failures.add("/api/change-orders"); mount();
    await screen.findByRole("alert");
    expect(screen.queryByText("No change orders yet")).not.toBeInTheDocument();
    failures.clear();
    await userEvent.click(screen.getByTestId("button-retry-change-orders"));
    await ready();
  });

  it("blocks unavailable invoices and recovers without clearing entered scope", async () => {
    mount(); await ready(); failures.add("/api/invoices");
    await userEvent.click(screen.getByTestId("button-new-co"));
    await screen.findByTestId("co-invoice-error");
    change("input-co-description", "Keep this scope");
    change("input-co-amount", "10.25");
    expect(screen.getByTestId("button-save-co")).toBeDisabled();
    failures.clear();
    await userEvent.click(screen.getByTestId("button-retry-co-invoices"));
    await waitFor(() => expect(screen.getByTestId("select-co-invoice")).toBeEnabled());
    await select("select-co-invoice", /INV-1/);
    expect(screen.getByTestId("input-co-description")).toHaveValue("Keep this scope");
    await userEvent.click(screen.getByTestId("button-save-co"));
    await screen.findByTestId("row-co-co-new");
    expect(payload("POST")).toMatchObject({ invoiceId: "invoice-a", description: "Keep this scope", amount: "10.25" });
  });

  it("preserves a selected invoice across a failed refresh and recovery", async () => {
    mount(); await ready(); await openForm();
    change("input-co-description", "Keep selected invoice");
    change("input-co-amount", "10.25");
    failures.add("/api/invoices");
    await queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
    await screen.findByTestId("co-invoice-error");
    expect(screen.getByTestId("select-co-invoice")).toHaveTextContent("INV-1");
    expect(screen.getByTestId("button-save-co")).toBeDisabled();
    failures.clear();
    await userEvent.click(screen.getByTestId("button-retry-co-invoices"));
    await waitFor(() => expect(screen.getByTestId("button-save-co")).toBeEnabled());
    await userEvent.click(screen.getByTestId("button-save-co"));
    await screen.findByTestId("row-co-co-new");
    expect(payload("POST")).toMatchObject({ invoiceId: "invoice-a" });
  });

  it("keeps failed approvals pending and supports retry", async () => {
    mount(); await ready(); saveFailed = true;
    await userEvent.click(screen.getByTestId("button-mark-approved-co-co-add"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
    expect(screen.getByTestId("status-co-co-add")).toHaveTextContent("Pending");
    expect(screen.getByTestId("stat-co-pending-total")).toHaveTextContent("$100.15");
    saveFailed = false;
    await userEvent.click(screen.getByTestId("button-mark-approved-co-co-add"));
    await waitFor(() => expect(screen.getByTestId("status-co-co-add")).toHaveTextContent("Approved"));
    expect(screen.getByTestId("stat-co-pending-total")).toHaveTextContent("−$10.10");
  });

  it("distinguishes an empty ledger from an empty status filter", async () => {
    records = initialRecords.filter((record) => record.status === "draft");
    mount(); await screen.findByTestId("row-co-co-draft");
    await userEvent.click(screen.getByTestId("filter-co-pending"));
    expect(screen.getByTestId("change-orders-no-matches")).toHaveTextContent("No pending change orders");
    await userEvent.click(screen.getByRole("button", { name: "Show all orders" }));
    expect(screen.getByTestId("row-co-co-draft")).toBeVisible();
    records = [];
    await queryClient.invalidateQueries({ queryKey: ["/api/change-orders"] });
    expect(await screen.findByTestId("change-orders-empty")).toHaveTextContent("No change orders yet");
    expect(screen.getByTestId("stat-co-pending-total")).toHaveTextContent("$0.00");
  });

  it("blocks duplicate submission and dismissal while a save is pending", async () => {
    mount(); await ready(); await openForm();
    change("input-co-description", "One change only");
    change("input-co-amount", "1.23");
    const original = fetchMock.getMockImplementation()!;
    let release: (() => void) | undefined;
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Promise((resolve) => { release = () => resolve(original(input, init)); });
      }
      return original(input, init);
    });
    await userEvent.click(screen.getByTestId("button-save-co"));
    expect(screen.getByTestId("button-save-co")).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.submit(document.getElementById("change-order-form")!);
    expect(writes("POST")).toHaveLength(1);
    release!();
    await screen.findByTestId("row-co-co-new");
  });
});
