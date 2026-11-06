// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Materials from "../materials";
import { queryClient } from "@/lib/queryClient";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const jobs = [{ id: "job-a", title: "Hotel restoration" }, { id: "job-b", title: "Lobby repairs" }];
const now = new Date();
const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-03`;
const prior = new Date(now.getFullYear(), now.getMonth() - 1, 3);
const priorMonth = `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, "0")}-03`;
const base = { description: null, vendor: null, quantity: "4.00", unit: "bag", purchaseDate: thisMonth };
const initialRecords = [
  { ...base, id: "material-a", name: "Finishing plaster", description: "Fine finish", vendor: "Paint Co", price: "10.25", jobId: "job-a", job: jobs[0] },
  { ...base, id: "material-b", name: "Primer", price: "20.50", jobId: "job-b", job: jobs[1] },
  { ...base, id: "material-unassigned", name: "Brush set", price: "4.25", jobId: null, job: null },
  { ...base, id: "material-prior", name: "Previous month sealant", purchaseDate: priorMonth, price: "5.00", jobId: "job-a", job: jobs[0] },
];
let records: typeof initialRecords;
let failures: Set<string>;
let saveFailed: boolean;
let deleteFailed: boolean;
let fetchMock: ReturnType<typeof vi.fn>;
const pointerMethods = ["hasPointerCapture", "setPointerCapture", "releasePointerCapture", "scrollIntoView"];
const descriptors = new Map<string, PropertyDescriptor | undefined>();

function mount() { return render(<QueryClientProvider client={queryClient}><Materials /></QueryClientProvider>); }
async function ready() { await screen.findByTestId("row-material-material-a"); }
function change(id: string, value: string) { fireEvent.change(screen.getByTestId(id), { target: { value } }); }
function writes(method: string) { return fetchMock.mock.calls.filter(([, init]) => init?.method === method); }
async function select(id: string, name: string) {
  await userEvent.click(screen.getByTestId(id));
  await userEvent.click(await screen.findByRole("option", { name }));
}
async function fillPurchase() {
  change("input-material-name", "Test purchase");
  change("input-material-quantity", "3");
  change("input-material-price", "10.00");
  change("input-material-vendor", "Test vendor");
}

describe("Materials redesign", () => {
  beforeAll(() => {
    pointerMethods.forEach((method) => {
      descriptors.set(method, Object.getOwnPropertyDescriptor(HTMLElement.prototype, method));
      Object.defineProperty(HTMLElement.prototype, method, { configurable: true, value: method === "hasPointerCapture" ? () => false : () => {} });
    });
  });
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
      if (path === "/api/materials" && (!init?.method || init.method === "GET")) return Response.json(records);
      if (path === "/api/jobs") return Response.json(jobs);
      if (init?.method === "POST" || init?.method === "PATCH") {
        if (saveFailed) return Response.json({ error: "Could not save", details: { price: ["Check purchase total"] } }, { status: 400 });
        const values = JSON.parse(init.body as string);
        const record = {
          ...base, ...values, id: init.method === "POST" ? "material-new" : path.split("/").pop(),
          job: jobs.find((job) => job.id === values.jobId) ?? null,
        };
        records = init.method === "POST" ? [...records, record] : records.map((item) => item.id === record.id ? record : item);
        return Response.json(record);
      }
      if (init?.method === "DELETE") {
        if (deleteFailed) return Response.json({ error: "Cannot delete" }, { status: 500 });
        records = records.filter((item) => item.id !== path.split("/").pop());
        return new Response(null, { status: 204 });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { queryClient.clear(); vi.unstubAllGlobals(); });

  it("shows separate vendor, quantity, unit price and purchase total without multiplying stored cost", async () => {
    mount(); await ready();
    const row = screen.getByTestId("row-material-material-a");
    expect(row).toHaveTextContent("Paint Co");
    expect(row).toHaveTextContent("Hotel restoration");
    expect(row).toHaveTextContent("$2.56");
    expect(row).toHaveTextContent("$10.25");
    expect(screen.getByTestId("materials-table-scroll")).toHaveClass("relative", "overflow-x-auto");
    expect(screen.getByTestId("text-material-total")).toHaveTextContent("$40.00");
    expect(screen.getByTestId("stat-materials-monthly")).toHaveTextContent("$35.00");
    expect(screen.getByTestId("material-job-monthly-total-unassigned")).toHaveTextContent("$4.25");
    expect(screen.getByTestId("row-material-material-prior")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Materials" })).toHaveClass("!font-bold");
  });

  it("combines case-insensitive search and job filtering and recalculates the table total", async () => {
    mount(); await ready();
    change("input-search-materials", "  PAINT CO  ");
    expect(screen.getByTestId("row-material-material-a")).toBeInTheDocument();
    expect(screen.queryByTestId("row-material-material-b")).not.toBeInTheDocument();
    expect(screen.getByTestId("text-material-total")).toHaveTextContent("$10.25");
    change("input-search-materials", "");
    await select("select-filter-material-job", "Lobby repairs");
    expect(screen.getByTestId("row-material-material-b")).toBeInTheDocument();
    expect(screen.queryByTestId("row-material-material-a")).not.toBeInTheDocument();
    expect(screen.getByTestId("text-material-total")).toHaveTextContent("$20.50");
  });

  it("validates, saves an unassigned purchase and keeps the total cost unchanged by quantity", async () => {
    mount(); await ready();
    await userEvent.click(screen.getByTestId("button-add-material"));
    await userEvent.click(screen.getByTestId("button-save-material"));
    expect(await screen.findByText("Enter a material name.")).toBeInTheDocument();
    expect(writes("POST")).toHaveLength(0);
    await fillPurchase();
    await userEvent.click(screen.getByTestId("button-save-material"));
    expect(await screen.findByTestId("row-material-material-new")).toHaveTextContent("$10.00");
    expect(JSON.parse(writes("POST")[0][1].body as string)).toMatchObject({ name: "Test purchase", quantity: "3", price: "10.00", jobId: null, vendor: "Test vendor" });
    expect(screen.getByTestId("text-material-total")).toHaveTextContent("$50.00");
  });

  it("preserves the record on save error, then moves the purchase between jobs without changing its cost", async () => {
    mount(); await ready();
    await userEvent.click(screen.getByTestId("button-edit-material-material-a"));
    expect(screen.getByTestId("input-material-price")).toHaveValue(10.25);
    await select("select-material-job", "Lobby repairs");
    change("input-material-name", "Updated plaster"); saveFailed = true;
    await userEvent.click(screen.getByTestId("button-save-material"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not save purchase" })));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("input-material-name")).toHaveValue("Updated plaster");
    saveFailed = false;
    await userEvent.click(screen.getByTestId("button-save-material"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("row-material-material-a")).toHaveTextContent("Lobby repairs");
    expect(JSON.parse(writes("PATCH")[0][1].body as string)).toMatchObject({ jobId: "job-b", price: "10.25", quantity: "4.00" });
    expect(screen.getByTestId("text-material-total")).toHaveTextContent("$40.00");
  });

  it("requires delete confirmation, supports cancel and leaves failed deletion recoverable", async () => {
    mount(); await ready();
    await userEvent.click(screen.getByTestId("button-delete-material-material-a"));
    expect(writes("DELETE")).toHaveLength(0);
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("row-material-material-a")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-delete-material-material-a")); deleteFailed = true;
    await userEvent.click(screen.getByTestId("button-confirm-delete-material"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not delete purchase" })));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    deleteFailed = false;
    await userEvent.click(screen.getByTestId("button-confirm-delete-material"));
    await waitFor(() => expect(screen.queryByTestId("row-material-material-a")).not.toBeInTheDocument());
    expect(screen.getByTestId("text-material-total")).toHaveTextContent("$29.75");
  });

  it("shows load failure rather than empty data and supports retry", async () => {
    failures.add("/api/materials"); mount();
    const alert = await screen.findByRole("alert");
    expect(screen.queryByText("No purchases yet")).not.toBeInTheDocument();
    failures.clear();
    await userEvent.click(within(alert).getByRole("button", { name: /retry|try again/i }));
    await ready();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not silently clear an existing job assignment when the jobs list fails", async () => {
    failures.add("/api/jobs"); mount(); await ready();
    expect(await screen.findByRole("alert")).toHaveTextContent(/job/i);
    await userEvent.click(screen.getByTestId("button-edit-material-material-a"));
    expect(screen.getByTestId("select-material-job")).toBeDisabled();
    change("input-material-name", "Plaster with job retained");
    const button = screen.getByTestId("button-save-material");
    if (!(button as HTMLButtonElement).disabled) {
      await userEvent.click(button);
      await waitFor(() => expect(writes("PATCH")).toHaveLength(1));
      expect(JSON.parse(writes("PATCH")[0][1].body as string).jobId).toBe("job-a");
    } else {
      expect(writes("PATCH")).toHaveLength(0);
    }
  });
});
