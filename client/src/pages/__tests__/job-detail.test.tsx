// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JobDetail from "../job-detail";
import { queryClient } from "@/lib/queryClient";

const { navigate, toast } = vi.hoisted(() => ({ navigate: vi.fn(), toast: vi.fn() }));
vi.mock("wouter", async (original) => ({
  ...await original<typeof import("wouter")>(),
  useParams: () => ({ id: "job-1" }),
  useLocation: () => ["/jobs/job-1", navigate],
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/components/job-form", () => ({
  default: ({ job }: { job: { title: string } }) => <div>Editing {job.title}</div>,
}));

const invoice = {
  id: "invoice-1", invoiceNumber: "JOX-TEST", status: "sent",
  total: "1250", balance: "750", amountPaid: "500",
  issueDate: "2026-10-01", dueDate: "2026-10-31",
  lineItems: [{ id: "co-1", isChangeOrder: true, category: "labor", description: "Extra ceiling",
    changeOrderReason: "Client requested", amount: "250" }],
};
const job = {
  id: "job-1", title: "Interior plaster", status: "in_progress", estimatedTotal: "1500",
  client: { id: "client-1", name: "Test client" }, clientId: "client-1",
  description: "Skim coat walls", address: "12 Test Street", squareFootage: "200",
  startDate: null, endDate: null, createdAt: "2026-10-01",
  referenceCodes: [{ label: "PO", code: "TEST-PO" }],
  invoices: [invoice], employees: [{ id: "employee-1", name: "Test Worker", position: "Plasterer" }],
  outstandingBalance: "750", totalMaterialCost: "30",
};
const pricing = [{ id: "line-1", category: "labor", description: "Wall finish", section: "Living room",
  quantity: "10", unit: "hours", rate: "100", amount: "1000", isChangeOrder: false }];
const material = { id: "material-1", name: "Plaster", quantity: "4", price: "30", unit: "bag", vendor: "Supplier" };
const document = { id: "doc-1", fileName: "plan.pdf", fileType: "application/pdf",
  fileSize: 120, uploadedAt: "2026-10-01" };
let currentJob = job;
let documents = [document];
let failures: Set<string>;
let fetchMock: ReturnType<typeof vi.fn>;

function mount() {
  return render(<QueryClientProvider client={queryClient}><JobDetail /></QueryClientProvider>);
}
async function ready() {
  await screen.findByTestId("text-job-title");
  await screen.findByText("Wall finish");
}
describe("Job detail redesign", () => {
  beforeEach(() => {
    queryClient.clear();
    currentJob = structuredClone(job);
    documents = [document];
    failures = new Set();
    navigate.mockReset(); toast.mockReset();
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (failures.has(path)) return new Response(JSON.stringify({ error: "Unavailable" }), { status: 503 });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (init?.method === "POST") return Response.json(document);
      if (path.endsWith("/documents")) return Response.json(documents);
      if (path.endsWith("/line-items")) return Response.json(pricing);
      if (path.startsWith("/api/materials?")) return Response.json([material]);
      return Response.json(currentJob);
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { queryClient.clear(); vi.unstubAllGlobals(); });

  it("renders real pricing, materials, crew and financial details without invented progress", async () => {
    mount(); await ready();
    expect(screen.getByText("Living room")).toBeInTheDocument();
    expect(await screen.findByText("Plaster")).toBeInTheDocument();
    expect(screen.getByText("Test Worker")).toBeInTheDocument();
    expect(screen.getByText("Not tracked")).toBeInTheDocument();
    expect(screen.queryByText("50%")).not.toBeInTheDocument();
    const link = screen.getByTestId("button-view-invoice-invoice-1");
    expect(link).toHaveTextContent("Due Oct 31, 2026");
    expect(link).toHaveTextContent("Balance $750.00");
    expect(screen.getByTestId("button-create-invoice-for-job")).toHaveAttribute("href", "/invoices/new?jobId=job-1");
    expect(screen.getByRole("link", { name: /Manage pricing/ })).toHaveAttribute("href", "/jobs/job-1/line-items");
    expect(screen.getByTestId("text-job-material-total")).toHaveTextContent("$30.00");
    // Existing materials store the recorded purchase price, not a unit rate.
    expect(screen.getByText("Plaster").parentElement?.parentElement?.parentElement).toHaveTextContent("$30.00");
  });

  it("opens the existing edit form and uses the existing invoice change-order flow", async () => {
    mount(); await ready();
    await userEvent.click(screen.getByTestId("button-edit-job"));
    expect(screen.getByRole("dialog")).toHaveTextContent("Editing Interior plaster");
    fireEvent.keyDown(documentGlobal(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await userEvent.click(screen.getAllByRole("button", { name: "Add change order" })[0]);
    expect(navigate).toHaveBeenCalledWith("/invoices/invoice-1");
  });

  it("lets users choose an invoice for a change order and explains the prerequisite without one", async () => {
    currentJob = { ...job, invoices: [invoice, { ...invoice, id: "invoice-2", invoiceNumber: "JOX-SECOND" }] };
    const view = mount(); await ready();
    await userEvent.click(screen.getAllByRole("button", { name: "Add change order" })[0]);
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Open invoice" })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("button", { name: /JOX-SECOND/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Open invoice" }));
    expect(navigate).toHaveBeenCalledWith("/invoices/invoice-2");
    view.unmount(); queryClient.clear();
    currentJob = { ...job, invoices: [] };
    mount(); await ready();
    expect(screen.getByText(/Create an invoice first/)).toBeInTheDocument();
  });

  it("requires confirmation before document and invoice deletion and preserves cancellation", async () => {
    mount(); await ready();
    await userEvent.click(screen.getByTestId("button-delete-doc-doc-1"));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("permanently delete the file");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    await userEvent.click(screen.getByTestId("button-delete-doc-doc-1"));
    await userEvent.click(screen.getByTestId("button-confirm-delete-document"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/job-documents/doc-1", expect.objectContaining({ method: "DELETE" })));
    await userEvent.click(screen.getByTestId("button-delete-invoice-invoice-1"));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("invoice and all its line items");
    await userEvent.click(screen.getByTestId("button-confirm-delete-invoice"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/invoices/invoice-1", expect.objectContaining({ method: "DELETE" })));
  });

  it("keeps upload validation and uploads documents through the existing endpoint", async () => {
    mount(); await ready();
    const input = screen.getByTestId("input-document-file");
    const oversized = new File(["data"], "large.pdf", { type: "application/pdf" });
    Object.defineProperty(oversized, "size", { value: 11 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [oversized] } });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "File must be under 10 MB" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    fireEvent.change(input, { target: { files: [new File(["plan"], "plan.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/jobs/job-1/documents", expect.objectContaining({ method: "POST", body: expect.any(FormData) })));
  });

  it("shows explicit errors for pricing, documents and materials, and can retry job loading", async () => {
    failures = new Set(["/api/jobs/job-1/line-items", "/api/jobs/job-1/documents", "/api/materials?jobId=job-1"]);
    const view = mount();
    await screen.findByText(/Pricing details couldn’t be loaded/);
    expect(await screen.findByText(/Materials couldn’t be loaded/)).toBeInTheDocument();
    expect(await screen.findByText(/Documents couldn’t be loaded/)).toBeInTheDocument();
    expect(screen.queryByText("No materials recorded for this job yet.")).not.toBeInTheDocument();
    view.unmount(); queryClient.clear();
    failures = new Set(["/api/jobs/job-1"]);
    mount(); await screen.findByRole("heading", { name: "Job didn’t load" });
    failures.clear();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await ready();
  });

  it("shows 100 percent only when the job is completed", async () => {
    currentJob = { ...job, status: "completed" };
    mount(); await ready();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.queryByText("Not tracked")).not.toBeInTheDocument();
  });
});

// Keep the DOM reference separate from the job-document fixture.
function documentGlobal() { return window.document; }
