// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

// jsdom has no ResizeObserver; Radix checkboxes (email recipients) measure with it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

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
let proofreadCalls: Array<Record<string, any>> = [];
let proofreadResponse: () => Response = () => Response.json({ error: "not set up" }, { status: 503 });
let draftPuts: Array<Record<string, unknown>>;
let sends: number;
let clientRecord: Record<string, unknown>;
let clientPatches: Array<Record<string, unknown>>;

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
    clientRecord = { ...client }; clientPatches = []; draftPuts = []; sends = 0;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (failures.has(path)) return Response.json({ error: "Unavailable" }, { status: 503 });
      if (path === "/api/clients") return Response.json([clientRecord]);
      if (path === `/api/clients/${client.id}` && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        clientPatches.push(body);
        clientRecord = { ...clientRecord, ...body };
        return Response.json(clientRecord);
      }
      if (path === "/api/jobs") return Response.json([job]);
      if (path === "/api/settings") return Response.json({ companyName: "Test Builder", companyAddress: "1 Business Street", invoiceTerms: "Net 30" });
      if (path === "/api/google-docs/status") return Response.json({ connected: googleConnected, email: null });
      if (path === "/api/google-docs/documents") return Response.json([{ id: "doc-1", name: "Hotel estimate", modifiedTime: null, webViewLink: null }]);
      if (path === "/api/invoices/parse-document" || path === "/api/invoices/parse-google-doc") return Response.json(parsed);
      if (path === "/api/invoices/inv-7" && (!init?.method || init.method === "GET")) {
        return Response.json({
          id: "inv-7", status: "draft", invoiceNumber: "JBX-2026-0007", clientId: client.id, jobId: job.id,
          issueDate: "2026-11-01T00:00:00.000Z", dueDate: "2026-11-30T00:00:00.000Z", notes: "Reopened notes", termsAndConditions: "Net 30",
          taxRate: "5", recipientEmails: [client.email],
          lineItems: [{ category: "labor", description: "Saved earlier", quantity: "3", unit: "hours", rate: "40", amount: "120", section: "Ground floor", refs: null, status: "in_progress" }],
        });
      }
      if (path.endsWith("/draft") && init?.method === "PUT") {
        draftPuts.push(JSON.parse(String(init.body)));
        return Response.json({ id: path.split("/")[3], invoiceNumber: "JBX-2026-0009", status: "draft" });
      }
      if (path === "/api/invoices/new-invoice/send" && init?.method === "POST") {
        sends += 1;
        return Response.json({ id: "new-invoice", status: "sent" });
      }
      if (path === "/api/invoices/proofread" && init?.method === "POST") {
        proofreadCalls.push(JSON.parse(String(init.body)));
        return proofreadResponse();
      }
      if (path === "/api/invoices" && init?.method === "POST") {
        return rejectSave
          ? Response.json({ error: "Check invoice", details: { dueDate: ["Due date needs correction"] } }, { status: 400 })
          : Response.json({ id: "new-invoice", invoiceNumber: "JBX-NEW" });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    proofreadCalls = [];
    proofreadResponse = () => Response.json({ error: "not set up" }, { status: 503 });
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

  it("ticks every client email and saves the recipients that stay ticked", async () => {
    clientRecord = { ...client, additionalEmails: ["ap@northline.test", "pm@northline.test"] };
    mount(); await ready(); await addItem();
    for (const email of [client.email, "ap@northline.test", "pm@northline.test"]) {
      expect(await screen.findByTestId(`checkbox-recipient-${email}`)).toHaveAttribute("aria-checked", "true");
    }

    await userEvent.click(screen.getByTestId("checkbox-recipient-pm@northline.test"));
    await userEvent.click(screen.getByTestId("button-save-draft"));

    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(JSON.parse(creates()[0][1].body as string).recipientEmails).toEqual([client.email, "ap@northline.test"]);
  });

  it("won't save when every email is unticked", async () => {
    mount(); await ready(); await addItem();
    await userEvent.click(await screen.findByTestId(`checkbox-recipient-${client.email}`));
    await userEvent.click(screen.getByTestId("button-save-draft"));

    await waitFor(() => expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "No email recipients" })));
    expect(creates()).toHaveLength(0);
  });

  it("adds a new email to the client and sends to it", async () => {
    mount(); await ready(); await addItem();
    fireEvent.change(await screen.findByTestId("input-add-recipient"), { target: { value: "billing@northline.test" } });
    await userEvent.click(screen.getByTestId("button-add-recipient"));

    await waitFor(() => expect(clientPatches).toEqual([{ additionalEmails: ["billing@northline.test"] }]));
    expect(await screen.findByTestId("checkbox-recipient-billing@northline.test")).toHaveAttribute("aria-checked", "true");

    await userEvent.click(screen.getByTestId("button-save-draft"));
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(JSON.parse(creates()[0][1].body as string).recipientEmails).toEqual([client.email, "billing@northline.test"]);
  });

  it("rejects an invalid or duplicate email without saving it", async () => {
    mount(); await ready();
    fireEvent.change(await screen.findByTestId("input-add-recipient"), { target: { value: "not-an-email" } });
    await userEvent.click(screen.getByTestId("button-add-recipient"));
    expect(await screen.findByText("Enter a valid email")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-add-recipient"), { target: { value: client.email.toUpperCase() } });
    await userEvent.click(screen.getByTestId("button-add-recipient"));
    expect(await screen.findByText("That email is already listed")).toBeInTheDocument();
    expect(clientPatches).toHaveLength(0);
  });

  it("gives new items a pending work status that can be changed before saving", async () => {
    mount(); await ready(); await addItem();
    const select = screen.getAllByTestId(/^select-item-status-/)[0] as HTMLSelectElement;
    expect(select.value).toBe("pending");
    fireEvent.change(select, { target: { value: "in_progress" } });

    await userEvent.click(screen.getByTestId("button-save-draft"));
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(JSON.parse(creates()[0][1].body as string).lineItems[0].status).toBe("in_progress");
  });

  it("autosaves a draft two seconds after the first real edit, then updates it in place", async () => {
    mount(); await ready(); await addItem();
    expect(screen.getByTestId("autosave-status")).toHaveTextContent("Unsaved changes");
    expect(creates()).toHaveLength(0);

    await waitFor(() => expect(creates()).toHaveLength(1), { timeout: 4000 });
    expect(JSON.parse(creates()[0][1].body as string)).toMatchObject({ clientId: client.id, send: false });
    await waitFor(() => expect(screen.getByTestId("autosave-status")).toHaveTextContent("Saved · JBX-NEW"));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Draft JBX-NEW");

    fireEvent.change(screen.getAllByTestId(/^input-item-desc-/)[0], { target: { value: "Finish plaster walls and trim" } });
    await waitFor(() => expect(draftPuts).toHaveLength(1), { timeout: 4000 });
    expect(draftPuts[0].lineItems).toEqual([expect.objectContaining({ description: "Finish plaster walls and trim" })]);
    expect(creates()).toHaveLength(1);
  }, 12000);

  it("sends an autosaved draft by saving it and calling send, not by creating a second invoice", async () => {
    mount(); await ready(); await addItem();
    await waitFor(() => expect(creates()).toHaveLength(1), { timeout: 4000 });

    fireEvent.click(screen.getByTestId("button-send-invoice"));
    await waitFor(() => expect(sends).toBe(1));
    expect(creates()).toHaveLength(1);
    expect(draftPuts).toHaveLength(1);
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/invoices/new-invoice"));
  }, 12000);

  it("reopens a draft from ?draft= with its items and fields, without saving it straight back", async () => {
    state.search = "draft=inv-7";
    mount();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Draft JBX-2026-0007"));
    expect(screen.getAllByTestId(/^input-item-desc-/)[0]).toHaveValue("Saved earlier");
    expect(screen.getByTestId("input-invoice-tax-rate")).toHaveValue(5);
    expect(screen.getByTestId("autosave-status")).toHaveTextContent("Saved · JBX-2026-0007");

    // Long enough for an autosave to have fired if the loaded data were treated as a change.
    await new Promise((resolve) => setTimeout(resolve, 2400));
    expect(draftPuts).toHaveLength(0);
    expect(creates()).toHaveLength(0);
    expect(screen.getByTestId("autosave-status")).toHaveTextContent("Saved · JBX-2026-0007");
  }, 10000);

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

  it("tidies wording when a field is left", async () => {
    mount(); await ready(); await addItem();
    const desc = screen.getAllByTestId(/^input-item-desc-/)[0];
    fireEvent.change(desc, { target: { value: "  prep walls ,two coats   eggshell" } });
    fireEvent.blur(desc);
    expect(desc).toHaveValue("Prep walls, two coats eggshell");
    const notes = screen.getByTestId("input-invoice-notes");
    fireEvent.change(notes, { target: { value: "thanks for your business!!" } });
    fireEvent.blur(notes);
    expect(notes).toHaveValue("Thanks for your business!");
  });

  it("proofreads before saving and only continues once every issue is fixed or kept", async () => {
    proofreadResponse = () => {
      const sent = proofreadCalls[proofreadCalls.length - 1].fields as Array<{ id: string; text: string }>;
      const item = sent.find((field) => field.id.startsWith("item:"))!;
      return Response.json({ issues: [
        { fieldId: item.id, kind: "spelling", original: "wals", replacement: "walls", note: "Misspelled" },
        { fieldId: "notes", kind: "spelling", original: "Sherwin-Wiliams", replacement: "Sherwin-Williams", note: "Brand name" },
      ] });
    };
    mount(); await ready(); await addItem();
    fireEvent.change(screen.getAllByTestId(/^input-item-desc-/)[0], { target: { value: "finish plaster wals ,two coats" } });
    fireEvent.change(screen.getByTestId("input-invoice-notes"), { target: { value: "Paint by Sherwin-Wiliams" } });
    await userEvent.click(screen.getByTestId("button-save-draft"));

    const dialog = await screen.findByTestId("dialog-proofread");
    expect(creates()).toHaveLength(0);
    // Text was tidied before it was checked.
    const checked = proofreadCalls[0].fields as Array<{ id: string; text: string }>;
    expect(checked.find((field) => field.id.startsWith("item:"))!.text).toBe("Finish plaster wals, two coats");
    expect(screen.getByTestId("button-proofread-continue")).toBeDisabled();

    const itemId = checked.find((field) => field.id.startsWith("item:"))!.id;
    await userEvent.click(screen.getByTestId(`button-fix-${itemId}`));
    expect(screen.getAllByTestId(/^input-item-desc-/)[0]).toHaveValue("Finish plaster walls, two coats");
    expect(screen.getByTestId("button-proofread-continue")).toBeDisabled();
    await userEvent.click(screen.getByTestId("button-keep-notes"));
    expect(dialog).toHaveTextContent("ready");
    await userEvent.click(screen.getByTestId("button-proofread-continue"));

    await waitFor(() => expect(creates()).toHaveLength(1));
    const payload = JSON.parse(creates()[0][1].body as string);
    expect(payload.lineItems[0].description).toBe("Finish plaster walls, two coats");
    expect(payload.notes).toBe("Paint by Sherwin-Wiliams");
    expect(screen.queryByTestId("dialog-proofread")).not.toBeInTheDocument();
  });

  it("remembers kept words and saves straight through when the proofreader finds nothing", async () => {
    let calls = 0;
    proofreadResponse = () => {
      calls += 1;
      return calls === 1
        ? Response.json({ issues: [{ fieldId: "notes", kind: "spelling", original: "Wiliams", replacement: "Williams", note: "?" }] })
        : Response.json({ issues: [] });
    };
    mount(); await ready(); await addItem();
    fireEvent.change(screen.getByTestId("input-invoice-notes"), { target: { value: "Wiliams job" } });
    await userEvent.click(screen.getByTestId("button-save-draft"));
    await screen.findByTestId("dialog-proofread");
    await userEvent.click(screen.getByTestId("button-keep-notes"));
    await userEvent.click(screen.getByTestId("button-proofread-cancel"));
    expect(creates()).toHaveLength(0);

    await userEvent.click(screen.getByTestId("button-save-draft"));
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(proofreadCalls[1].ignore).toEqual(["Wiliams"]);
  });
});
