// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GustoPayrollWorkspace from "../gusto-payroll-workspace";
import type { GustoDemoSetupStatus } from "../gusto-demo-company-setup";

const initialStatus: GustoDemoSetupStatus = {
  configured: false, environment: "demo",
  setup: { clientConfigured: true, canCreateDemoCompany: true, creationState: null },
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});

describe("Gusto demo company setup in the payroll workspace", () => {
  let client: QueryClient;
  let fetchMock: ReturnType<typeof vi.fn>;
  let status: GustoDemoSetupStatus;
  let createResponse: () => Promise<Response>;

  beforeEach(() => {
    status = structuredClone(initialStatus);
    createResponse = async () => json({ companyId: "demo-company", environment: "demo", state: "connected" }, 201);
    fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/gusto/demo-company" && init?.method === "POST") return createResponse();
      if (url === "/api/gusto/status") return Promise.resolve(json(status));
      if (url === "/api/gusto/employees/readiness") return Promise.resolve(json({ employees: [] }));
      if (url === "/api/gusto/payroll-runs") return Promise.resolve(json({ runs: [] }));
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    client = new QueryClient({ defaultOptions: { queries: {
      retry: false, staleTime: Infinity,
      queryFn: async ({ queryKey }) => (await fetch(String(queryKey[0]))).json(),
    } } });
  });

  afterEach(() => {
    cleanup();
    client.clear();
    vi.unstubAllGlobals();
  });

  function mount() {
    client.setQueryData(["/api/gusto/status"], status);
    client.setQueryData(["/api/gusto/payroll-runs"], { runs: [] });
    client.setQueryData(["/api/gusto/employees/readiness"], { employees: [] });
    return render(<QueryClientProvider client={client}><GustoPayrollWorkspace records={[]} period={null} /></QueryClientProvider>);
  }
  function fill() {
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Harbor Electric" } });
    fireEvent.change(screen.getByLabelText("Administrator first name"), { target: { value: "Morgan" } });
    fireEvent.change(screen.getByLabelText("Administrator last name"), { target: { value: "Reed" } });
    fireEvent.change(screen.getByLabelText("Administrator email"), { target: { value: "payroll@example.test" } });
  }
  const requests = () => fetchMock.mock.calls.filter(([url]) => url === "/api/gusto/demo-company");

  it("takes the demo setup action to the form without calling the old connect endpoint", () => {
    const scroll = vi.fn();
    const previous = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scroll;
    try {
      mount();
      expect(screen.queryByRole("button", { name: "Connect Gusto company" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Funding setup" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Set up demo company" }));
      expect(scroll).toHaveBeenCalledOnce();
      expect(screen.getByLabelText("Company name")).toHaveFocus();
      expect(fetchMock.mock.calls.some(([url]) => url === "/api/gusto/connect" || url === "/api/gusto/demo-company")).toBe(false);
    } finally {
      HTMLElement.prototype.scrollIntoView = previous;
    }
  });

  it("does not offer the demo action when creation is blocked", () => {
    status = { ...status, setup: { clientConfigured: true, canCreateDemoCompany: false, creationState: "demo_creation_unknown" } };
    mount();
    expect(screen.queryByRole("button", { name: "Set up demo company" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Gusto company" })).not.toBeInTheDocument();
    expect(screen.getByText(/creation is blocked/)).toBeInTheDocument();
  });

  it("starts blank, explains administrator contact, and requires valid fields and explicit confirmation", () => {
    mount();
    expect(screen.getByLabelText("Administrator email")).toHaveValue("");
    expect(screen.getByText(/Gusto may contact this email address/)).toBeInTheDocument();
    expect(screen.getByText(/application is configured, but company credentials are not ready/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Create Gusto demo company" });
    expect(button).toBeDisabled();
    fill();
    expect(button).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Create Gusto demo company" }));
    expect(requests()).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(button).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Administrator email"), { target: { value: "not-an-email" } });
    expect(button).toBeDisabled();
  });

  it("posts the exact contract once, prevents pending duplicates, and refreshes status and readiness", async () => {
    let resolve!: (response: Response) => void;
    createResponse = () => new Promise<Response>(done => { resolve = done; });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    mount();
    fill();
    fireEvent.click(screen.getByRole("checkbox"));
    const form = screen.getByRole("form", { name: "Create Gusto demo company" });
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(requests()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Creating demo company…" })).toBeDisabled();
    expect(requests()[0][1]).toMatchObject({ method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } });
    expect(JSON.parse(String(requests()[0][1]?.body))).toEqual({
      companyName: "Harbor Electric", firstName: "Morgan", lastName: "Reed",
      email: "payroll@example.test", confirmDemo: true,
    });
    status = { ...status, configured: true, companyId: "demo-company", state: "connected" };
    resolve(json({ companyId: "demo-company", environment: "demo", state: "connected" }, 201));
    expect(await screen.findByText(/Demo company created and connected/)).toBeInTheDocument();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/gusto/employees/readiness"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/gusto/status"] });
    expect(screen.queryByRole("form", { name: "Create Gusto demo company" })).not.toBeInTheDocument();
  });

  it.each([400, 409, 502, 503])("handles HTTP %s safely, refreshes eligibility, and never auto-retries", async code => {
    createResponse = async () => {
      status = { ...status, setup: { clientConfigured: true, canCreateDemoCompany: false, creationState: "demo_creation_unknown" } };
      return json({ error: "Sensitive provider detail", code: "PROVIDER_FAILURE" }, code);
    };
    const invalidate = vi.spyOn(client, "invalidateQueries");
    mount();
    fill();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create Gusto demo company" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be confirmed/);
    expect(screen.queryByText(/Sensitive provider detail/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/creation is blocked/)).toBeInTheDocument());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/gusto/status"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["/api/gusto/employees/readiness"] });
    expect(requests()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Create Gusto demo company" })).not.toBeInTheDocument();
  });

  it("locks an ambiguous network failure even when stale eligibility still allows creation", async () => {
    createResponse = async () => { throw new TypeError("Network lost"); };
    mount();
    fill();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create Gusto demo company" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Do not submit again");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/gusto/status"));
    expect(screen.queryByRole("form", { name: "Create Gusto demo company" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(requests()).toHaveLength(1);
  });

  it("rejects blank names, overlong values, and unconfirmed programmatic submissions", () => {
    mount();
    fill();
    fireEvent.click(screen.getByRole("checkbox"));
    const form = screen.getByRole("form", { name: "Create Gusto demo company" });
    for (const [label, value] of [
      ["Company name", " "],
      ["Company name", "x".repeat(201)],
      ["Administrator first name", " "],
      ["Administrator first name", "x".repeat(101)],
      ["Administrator last name", " "],
      ["Administrator last name", "x".repeat(101)],
      ["Administrator email", `${"x".repeat(250)}@example.test`],
    ]) {
      fill();
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      fireEvent.submit(form);
      expect(requests()).toHaveLength(0);
    }
  });

  it("treats an unexpected success response as uncertain instead of claiming connection", async () => {
    createResponse = async () => json({ state: "connected" }, 201);
    mount();
    fill();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create Gusto demo company" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be confirmed");
    expect(screen.queryByRole("form", { name: "Create Gusto demo company" })).not.toBeInTheDocument();
    expect(requests()).toHaveLength(1);
  });

  it.each([
    { environment: "production" },
    { environment: undefined },
    { configured: true },
    { companyId: "existing-company" },
    { state: "connected" },
    { setup: { clientConfigured: true, canCreateDemoCompany: false, creationState: null } },
    { setup: { clientConfigured: true, canCreateDemoCompany: false, creationState: "demo_creating" } },
    { setup: { clientConfigured: true, canCreateDemoCompany: false, creationState: "demo_creation_unknown" } },
    { setup: { clientConfigured: true, canCreateDemoCompany: true, creationState: "demo_creating" } },
    { setup: { clientConfigured: true, canCreateDemoCompany: true, creationState: "demo_creation_unknown" } },
  ])("does not offer creation for blocked or ineligible status %j", override => {
    status = { ...initialStatus, ...override };
    mount();
    expect(screen.queryByRole("form", { name: "Create Gusto demo company" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Gusto demo company" })).not.toBeInTheDocument();
    expect(requests()).toHaveLength(0);
  });

  it.each(["demo_creation_failed", "not_connected", "error"])("allows a fresh form after remount with authoritative safe state %s", creationState => {
    status = { ...initialStatus, setup: { clientConfigured: true, canCreateDemoCompany: true, creationState } };
    const view = mount();
    view.unmount();
    mount();
    expect(screen.getByRole("form", { name: "Create Gusto demo company" })).toBeInTheDocument();
    expect(screen.queryByText(/creation is blocked/)).not.toBeInTheDocument();
    expect(requests()).toHaveLength(0);
  });

  it.each([
    [400, "invalid_input", "Enter a company name, administrator name and valid email, and confirm demo setup."],
    [502, "creation_rejected", "Gusto did not create the demo company. Check the application credentials and entered company details before retrying."],
    [502, "creation_rejected", "Gusto rejected the developer credentials or application permissions. Verify these are Embedded Payroll demo credentials."],
  ] as const)("offers an explicit retry after known %s %s and refreshed eligibility", async (httpStatus, code, message) => {
    createResponse = async () => {
      status = { ...status, setup: { clientConfigured: true, canCreateDemoCompany: true, creationState: "demo_creation_failed" } };
      return json({ error: message, code }, httpStatus);
    };
    mount();
    fill();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create Gusto demo company" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(requests()).toHaveLength(1);
    fireEvent.click(retry);
    expect(requests()).toHaveLength(1);
    expect(screen.getByLabelText("Company name")).toHaveValue("Harbor Electric");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Create Gusto demo company" })).toBeDisabled();
    createResponse = async () => json({ companyId: "demo-company", environment: "demo", state: "connected" }, 201);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create Gusto demo company" }));
    expect(await screen.findByText(/Demo company created and connected/)).toBeInTheDocument();
    expect(requests()).toHaveLength(2);
  });

  it("does not offer retry after definite rejection if refreshed status blocks creation", async () => {
    createResponse = async () => {
      status = { ...status, setup: { clientConfigured: true, canCreateDemoCompany: false, creationState: "demo_creating" } };
      return json({ error: "Enter a company name, administrator name and valid email, and confirm demo setup.", code: "invalid_input" }, 400);
    };
    mount();
    fill();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create Gusto demo company" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a company name");
    await screen.findByText(/creation is blocked/);
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(requests()).toHaveLength(1);
  });

  it("withholds retry when status refresh fails, then allows it after an explicit successful refresh", async () => {
    let failStatus = false;
    const originalFetch = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/gusto/status" && failStatus) return Promise.reject(new TypeError("Status unavailable"));
      return originalFetch(url, init);
    });
    createResponse = async () => {
      failStatus = true;
      return json({ error: "Enter a company name, administrator name and valid email, and confirm demo setup.", code: "invalid_input" }, 400);
    };
    mount();
    fill();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create Gusto demo company" }));
    await waitFor(() => expect(client.getQueryState(["/api/gusto/status"])?.status).toBe("error"));
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    failStatus = false;
    fireEvent.click(screen.getByRole("button", { name: "Refresh Gusto status" }));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(requests()).toHaveLength(1);
  });
});
