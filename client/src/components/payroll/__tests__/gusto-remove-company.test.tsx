// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GustoPayrollWorkspace from "../gusto-payroll-workspace";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
let client: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;
let company: Record<string, unknown>;
let runs: Record<string, unknown>[];
let deletion: () => Promise<Response>;
const removals = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE");

beforeEach(() => {
  company = { configured: true, available: true, companyId: "demo-company", companyName: "Demo Business", environment: "demo", state: "connected" };
  runs = [];
  deletion = async () => {
    company = { configured: false, available: false, environment: "demo", state: "not_connected", setup: { clientConfigured: true, canCreateDemoCompany: true, creationState: null } };
    return json({ removed: true, removedFrom: "jobsoxo_only" });
  };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/gusto/company" && init?.method === "DELETE") return deletion();
    if (url === "/api/gusto/status") return json(company);
    if (url === "/api/gusto/payroll-runs") return json({ runs });
    if (url === "/api/gusto/employees/readiness") return json({ employees: [] });
    throw new Error("Unexpected request");
  });
  vi.stubGlobal("fetch", fetchMock);
  client = new QueryClient({ defaultOptions: { queries: {
    retry: false, staleTime: Infinity,
    queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json(),
  } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
function mount() {
  client.setQueryData(["/api/gusto/status"], company);
  client.setQueryData(["/api/gusto/payroll-runs"], { runs });
  client.setQueryData(["/api/gusto/employees/readiness"], { employees: [] });
  render(<QueryClientProvider client={client}><GustoPayrollWorkspace records={[]} period={null} /></QueryClientProvider>);
}

describe("remove company confirmation", () => {
  it("explains local-only removal and cancellation does not make a request", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Remove demo company" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("The company and its data will remain in Gusto.");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("timesheets, and worksheets will be kept");
    fireEvent.click(screen.getByRole("button", { name: "Keep company" }));
    expect(removals()).toHaveLength(0);
  });
  it("requires confirmation, sends the selected company ID, and returns to demo setup", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Remove demo company" }));
    expect(removals()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Remove from JobsOxo" }));
    await screen.findByRole("button", { name: "Set up demo company" });
    expect(removals()).toHaveLength(1);
    expect(JSON.parse(removals()[0][1].body)).toEqual({ companyId: "demo-company", confirmRemove: true });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
  it("blocks removal when saved payroll history exists", () => {
    runs = [{ id: "run", status: "draft", canCancel: false }];
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Remove demo company" }));
    expect(screen.getByRole("button", { name: "Remove from JobsOxo" })).toBeDisabled();
    expect(screen.getByText(/has saved payroll history/)).toBeInTheDocument();
    expect(removals()).toHaveLength(0);
  });
  it("does not offer removal for production or a disconnected company", () => {
    company.environment = "production";
    mount();
    expect(screen.queryByRole("button", { name: "Remove demo company" })).not.toBeInTheDocument();
    cleanup();
    company = { configured: false, environment: "demo" };
    mount();
    expect(screen.queryByRole("button", { name: "Remove demo company" })).not.toBeInTheDocument();
  });
  it("keeps the connection and dialog after server rejection", async () => {
    deletion = async () => json({ error: "This company has payroll history." }, 409);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Remove demo company" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove from JobsOxo" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove from JobsOxo" })).toBeEnabled());
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(removals()).toHaveLength(1);
  });
});
