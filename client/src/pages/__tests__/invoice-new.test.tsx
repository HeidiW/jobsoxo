// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InvoiceNew from "../invoice-new";
import { queryClient } from "@/lib/queryClient";

const state = vi.hoisted(() => ({
  search: "jobId=job-1", navigate: vi.fn(), toast: vi.fn(),
}));
vi.mock("wouter", async (original) => ({
  ...await original<typeof import("wouter")>(),
  useSearch: () => state.search,
  useLocation: () => ["/invoices/new", state.navigate],
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const client = { id: "client-1", name: "Northline Construction", address: "12 Test Street", email: "test@example.invalid" };
const job = { id: "job-1", clientId: client.id, client, title: "Hotel restoration", referenceCodes: [{ label: "PO", code: "PO-100" }] };
const parsed = {
  confidence: "high", sourceTitle: "Estimate", taxRate: 10, dueDate: "2026-11-30", notes: "Imported notes",
  lineItems: [
    { description: "Wall preparation", quantity: 5, unit: "hours", rate: 10, amount: 50, category: "labor", section: "Ground floor" },
    { description: "Ceiling finish", quantity: 2, unit: "hours", rate: 25, amount: 50, category: "labor", section: "First floor" },
  ],
};
let fetchMock: ReturnType<typeof vi.fn>;
let failures: Set<string>;
let googleConnected: boolean;
let rejectSave: boolean;

function mount() {
  return render(<QueryClientProvider client={queryClient}><InvoiceNew /></QueryClientProvider>);
}
async function ready() {
  await waitFor(() => expect(screen.getByTestId("select-invoice-client")).toHaveTextContent(client.name));
}
async function addItem() {
  await userEvent.click(screen.getByTestId("button-add-line-item"));
  fireEvent.change(screen.getAllByTestId(/^input-item-desc-/)[0], { target: { value: "Finish plaster walls" } });
  fireEvent.change(screen.getAllByTestId(/^input-item-qty-/)[0], { target: { value: "2" } });
  fireEvent.change(screen.getAllByTestId(/^input-item-rate-/)[0], { target: { value: "125" } });
}
function creates() {
  return fetchMock.mock.calls.filter(([path, init]) => path === "/api/invoices" && init?.method === "POST");
}
describe("New invoice redesign", () => {
  beforeEach(() => {
    queryClient.clear(); state.navigate.mockReset(); state.toast.mockReset();
    state.search = "jobId=job-1"; failures = new Set(); googleConnected = false; rejectSave = false;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (failures.has(path)) return Response.json({ error: "Unavailable" }, { status: 503 });
      if (path === "/api/clients") return Response.json([client]);
      if (path === "/api/jobs") return Response.json([job]);
      if (path === "/api/settings") return Response.json({ companyName: "Test Builder", companyAddress: "1 Business Street", invoiceTerms: "Net 30" });
      if (path === "/api/google-docs/status") return Response.json({ connected: googleConnected, email: null });
      if (path === "/api/google-docs/documents") return Response.json([{ id: "doc-1", name: "Hotel estimate", modifiedTime: null, webViewLink: null }]);
      if (path === "/api/invoices/parse-document" || path === "/api/invoices/parse-google-doc") return Response.json(parsed);
      if (path === "/api/invoices" && init?.method === "POST") {
        return rejectSave
          ? Response.json({ error: "Check invoice", details: { dueDate: ["Due date needs correction"] } }, { status: 400 })
          : Response.json({ id: "new-invoice", invoiceNumber: "JOX-NEW" });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { queryClient.clear(); vi.unstubAllGlobals(); });

  it("preselects the job and its client and updates the preview and tax from actual form values", async () => {
    mount(); await ready();
    expect(screen.getByTestId("select-invoice-job")).toHaveTextContent("Hotel restoration");
    expect(screen.getAllByText("Test Builder").length).toBeGreaterThan(0);
    expect(screen.getByTestId("input-invoice-tax-rate")).toHaveValue(0);
    await addItem();
    fireEvent.change(screen.getByTestId("input-invoice-tax-rate"), { target: { value: "10" } });
    expect(screen.getAllByText("$275.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$25.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Finish plaster walls").length).toBeGreaterThan(0);
    expect(screen.queryByText(/8\.875/)).not.toBeInTheDocument();
    expect(creates()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /PAY ONLINE/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Preview only.*payment isn.t active/)).toBeInTheDocument();
  });

  it("saves a real draft payload and navigates only after success", async () => {
    mount(); await ready(); await addItem();
    fireEvent.change(screen.getByTestId("input-invoice-tax-rate"), { target: { value: "10" } });
    await userEvent.click(screen.getByTestId("button-save-draft"));
    await waitFor(() => expect(creates()).toHaveLength(1));
    const payload = JSON.parse(creates()[0][1].body as string);
    expect(payload).toMatchObject({ clientId: client.id, jobId: job.id, send: false, subtotal: 250, taxAmount: 25, total: 275, balance: 275 });
    expect(payload.lineItems[0]).toMatchObject({ description: "Finish plaster walls", quantity: 2, rate: 125, amount: 250 });
    expect(payload.lineItems[0]).not.toHaveProperty("id");
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/invoices/new-invoice"));
  });

  it("preserves send=true, server field errors and the unsaved form on failure", async () => {
    rejectSave = true; mount(); await ready(); await addItem();
    await userEvent.click(screen.getByTestId("button-send-invoice"));
    expect(await screen.findByText("Due date needs correction")).toBeInTheDocument();
    expect(JSON.parse(creates()[0][1].body as string).send).toBe(true);
    expect(state.navigate).not.toHaveBeenCalled();
    expect(screen.getAllByTestId(/^input-item-desc-/)[0]).toHaveValue("Finish plaster walls");
  });

  it("prevents empty invoices and keeps section/item removal functional", async () => {
    mount(); await ready();
    await userEvent.click(screen.getByTestId("button-save-draft"));
    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "No line items" })));
    expect(creates()).toHaveLength(0);
    await addItem();
    await userEvent.click(screen.getAllByTestId(/^button-remove-item-/)[0]);
    expect(screen.queryAllByTestId(/^input-item-desc-/)).toHaveLength(0);
    expect(screen.queryByText("Finish plaster walls")).not.toBeInTheDocument();
  });

  it("validates upload size and reviews editable imported items before applying", async () => {
    mount(); await ready();
    const fileInput = screen.getByTestId("input-document-upload");
    const oversized = new File(["large"], "large.pdf", { type: "application/pdf" });
    Object.defineProperty(oversized, "size", { value: 11 * 1024 * 1024 });
    fireEvent.change(fileInput, { target: { files: [oversized] } });
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "File must be under 10 MB" }));
    expect(fetchMock.mock.calls.some(([path]) => path === "/api/invoices/parse-document")).toBe(false);
    fireEvent.change(fileInput, { target: { files: [new File(["estimate"], "estimate.pdf", { type: "application/pdf" })] } });
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Description for imported item 1"), { target: { value: "Updated wall preparation" } });
    fireEvent.change(within(dialog).getByLabelText("Amount for imported item 1"), { target: { value: "75" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Import 2 items" }));
    expect(screen.getAllByTestId(/^input-item-desc-/)).toHaveLength(2);
    expect(screen.getByDisplayValue("Updated wall preparation")).toBeInTheDocument();
    expect(screen.getByTestId("input-invoice-tax-rate")).toHaveValue(10);
    expect(screen.getAllByText("$137.50").length).toBeGreaterThan(0);
    expect(creates()).toHaveLength(0);
  });

  it("fetches Google documents only on demand and preserves the review step", async () => {
    googleConnected = true; mount(); await ready();
    expect(fetchMock.mock.calls.some(([path]) => path === "/api/google-docs/documents")).toBe(false);
    await userEvent.click(screen.getByTestId("button-import-google-doc"));
    await screen.findByTestId("button-google-doc-doc-1");
    fireEvent.change(screen.getByTestId("input-google-doc-search"), { target: { value: "not found" } });
    expect(screen.queryByTestId("button-google-doc-doc-1")).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId("input-google-doc-search"), { target: { value: "Hotel" } });
    await userEvent.click(screen.getByTestId("button-google-doc-doc-1"));
    await screen.findByLabelText("Description for imported item 1");
    expect(fetchMock).toHaveBeenCalledWith("/api/invoices/parse-google-doc", expect.objectContaining({ method: "POST", body: JSON.stringify({ documentId: "doc-1" }) }));
    expect(screen.queryAllByTestId(/^input-item-desc-/)).toHaveLength(0);
  });

  it("shows failed related-data loading explicitly and lets users retry", async () => {
    failures.add("/api/clients");
    mount();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/load|unavailable|try again/i);
    failures.clear();
    await userEvent.click(within(alert).getByRole("button", { name: /Retry|Try again/ }));
    await ready();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("preserves entered items when switching between builder, tabbed and split layouts", async () => {
    mount(); await ready(); await addItem();
    await userEvent.click(screen.getByRole("button", { name: "Builder" }));
    expect(screen.queryByText(/Preview only.*payment isn.t active/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^input-item-desc-/)[0]).toHaveValue("Finish plaster walls");
    await userEvent.click(screen.getByRole("button", { name: "Tabbed" }));
    await userEvent.click(screen.getByRole("button", { name: /2.*Line items/ }));
    expect(screen.getAllByTestId(/^input-item-desc-/)[0]).toHaveValue("Finish plaster walls");
    await userEvent.click(screen.getByRole("button", { name: "Split view" }));
    expect(screen.getAllByText("$250.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/Preview only.*payment isn.t active/)).toBeInTheDocument();
    expect(creates()).toHaveLength(0);
  });
});
