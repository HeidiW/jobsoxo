// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GustoPayrollWorkspace } from "@/pages/payroll";
import GustoBankView from "@/components/payroll/gusto-bank-view";

vi.mock("@/hooks/use-plaid-link", () => ({
  usePlaidLink: () => ({ open: vi.fn(), isLoading: false }),
}));

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Gusto payroll workspace", () => {
  let queryClient: QueryClient;
  let fetchMock: ReturnType<typeof vi.fn>;
  let createAttempts: number;
  let statusFails: boolean;
  let flowUrl: string;
  let runList: { runs: Array<Record<string, unknown>> };
  let detailRun: Record<string, unknown>;

  beforeEach(() => {
    createAttempts = 0;
    statusFails = false;
    flowUrl = "https://flows.gusto-demo.com/flows/company-onboarding";
    runList = { runs: [] };
    detailRun = { id: "run-1", status: "draft", canCancel: false, employees: [] };
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url === "/api/gusto/payroll-runs") {
        createAttempts += 1;
        if (createAttempts === 1) return Promise.resolve(jsonResponse({ error: "Temporary failure" }, 500));
        return Promise.resolve(jsonResponse({
          id: "run-1",
          status: "draft",
          canCancel: false,
          employees: [{
            id: "employee-1",
            name: "Jane Worker",
            hours: 40,
            days: 5,
            earnings: 1200,
            deductions: 100,
            reimbursements: 50,
            taxes: 0,
            netPay: 0,
          }],
        }));
      }
      if (url === "/api/gusto/payroll-runs" && (!init?.method || init.method === "GET")) {
        return Promise.resolve(jsonResponse(runList));
      }
      if (url === "/api/gusto/status") {
        if (statusFails) return Promise.resolve(jsonResponse({ error: "Gusto unavailable" }, 503));
        return Promise.resolve(jsonResponse({ configured: true, available: true, state: "connected", companyId: "company-1" }));
      }
      if (url === "/api/gusto/employees/readiness") {
        return Promise.resolve(jsonResponse({
          employees: [{ id: "employee-1", name: "Jane Worker", ready: true, blockers: [] }],
        }));
      }
      if (typeof url === "string" && url.startsWith("/api/gusto/payroll-runs/")) {
        return Promise.resolve(jsonResponse(detailRun));
      }
      if (url === "/api/gusto/flows" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ url: flowUrl }));
      }
      if (url === "/api/plaid/bank-summary") {
        return Promise.resolve(jsonResponse({ connected: false }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  it("aggregates employee records and reuses the idempotency key after a failed create", async () => {
    const records = [{
      id: "record-1",
      employeeId: "employee-1",
      status: "pending",
      createdAt: "2040-01-14",
      periodStart: "2040-01-01",
      periodEnd: "2040-01-14",
      totalHours: "40.00",
      dayRate: "240.00",
      grossPay: "1200.00",
      deductions: "100.00",
      netPay: "1100.00",
      regularHours: "40.00",
      overtimeHours: "0.00",
      regularPay: "1200.00",
      overtimePay: "0.00",
      taxWithheld: "0.00",
      deductionsBreakdown: [],
      employee: { id: "employee-1", name: "Jane Worker" },
    }, {
      id: "record-2",
      employeeId: "employee-1",
      totalHours: "4.00",
      grossPay: "100.00",
      dayRate: "240.00",
      employee: { id: "employee-1", name: "Jane Worker" },
    }] as any;

    queryClient.setQueryData(["/api/gusto/status"], { configured: true, available: true, state: "connected", companyId: "company-1" });
    queryClient.setQueryData(["/api/gusto/payroll-runs"], { runs: [] });
    queryClient.setQueryData(["/api/gusto/employees/readiness"], {
      employees: [{ id: "employee-1", name: "Jane Worker", ready: true, blockers: [] }],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <GustoPayrollWorkspace
          records={records}
          period={{ start: "2040-01-01", end: "2040-01-14" }}
        />
      </QueryClientProvider>,
    );

    const payDate = await screen.findByTestId("input-gusto-pay-date");
    const create = await screen.findByRole("button", { name: "Create Gusto payroll review" });
    expect(payDate).toBeInTheDocument();
    expect(create).toBeEnabled();

    fireEvent.change(payDate, { target: { value: "2040-01-18" } });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);

    await waitFor(() => expect(createAttempts).toBe(1));
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);
    await waitFor(() => {
      expect(createAttempts).toBe(2);
    });
    const requests = fetchMock.mock.calls.filter(
      ([url, init]) => url === "/api/gusto/payroll-runs" && init?.method === "POST",
    );
    expect(requests).toHaveLength(2);
    const payload = JSON.parse(String(requests[1]?.[1]?.body));
    const failedPayload = JSON.parse(String(requests[0]?.[1]?.body));
    expect(failedPayload.idempotencyKey).toBe(payload.idempotencyKey);
    expect(payload).toMatchObject({
      periodStart: "2040-01-01",
      periodEnd: "2040-01-14",
      payDate: "2040-01-18",
    });
    expect(payload.idempotencyKey).toEqual(expect.any(String));
    expect(payload.items).toEqual([expect.objectContaining({
      employeeId: "employee-1",
      hours: 44,
      grossEarnings: 1300,
    })]);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).not.toHaveProperty("days");
  });

  it("keeps the read-only bank view and Gusto history available when Gusto status fails", async () => {
    statusFails = true;
    runList = { runs: [{ id: "history-1", status: "paid", periodStart: "2040-01-01", periodEnd: "2040-01-14", canCancel: false }] };
    render(
      <QueryClientProvider client={queryClient}>
        <GustoBankView />
        <GustoPayrollWorkspace records={[]} period={{ start: "2040-01-01", end: "2040-01-14" }} />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("plaid-bank-view")).toBeInTheDocument();
    expect(await screen.findByText(/No account connected/)).toBeInTheDocument();
    expect(await screen.findByText(/Gusto status is unavailable/)).toBeInTheDocument();
    expect(await screen.findByTestId("gusto-payroll-history")).toBeInTheDocument();
    expect(screen.queryByText("Employee payments initiated")).not.toBeInTheDocument();
  });

  it("embeds only approved Gusto flow URLs in a sandboxed iframe", async () => {
    queryClient.setQueryData(["/api/gusto/status"], { configured: true, available: true, companyId: "company-1" });
    queryClient.setQueryData(["/api/gusto/payroll-runs"], { runs: [] });
    queryClient.setQueryData(["/api/gusto/employees/readiness"], { employees: [] });
    render(
      <QueryClientProvider client={queryClient}>
        <GustoPayrollWorkspace records={[]} period={null} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Open Complete company setup" }));
    const iframe = await screen.findByTitle("Complete company setup");
    expect(iframe).toHaveAttribute("src", "https://flows.gusto-demo.com/flows/company-onboarding");
    expect(iframe).toHaveAttribute("sandbox", "allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox");
    expect(fetchMock).toHaveBeenCalledWith("/api/gusto/flows", expect.objectContaining({ method: "POST" }));
  });

  it("puts unfinished setup steps on the company card and opens the matching Gusto flow", async () => {
    queryClient.setQueryData(["/api/gusto/status"], {
      configured: true, available: true, companyId: "company-1", environment: "demo", onboardingComplete: false,
      fundingAccount: { id: "bank-1", status: "awaiting_deposits" },
      blockers: ["Complete Gusto setup: Add Your Company's Addresses"],
    });
    queryClient.setQueryData(["/api/gusto/payroll-runs"], { runs: [] });
    queryClient.setQueryData(["/api/gusto/employees/readiness"], { employees: [] });
    render(
      <QueryClientProvider client={queryClient}>
        <GustoPayrollWorkspace records={[]} period={null} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTestId("button-gusto-complete-setup"));
    await screen.findByTitle("Complete company setup");
    expect(JSON.parse(fetchMock.mock.calls.find(([url]) => url === "/api/gusto/flows")![1].body)).toEqual({ flowType: "company_onboarding" });
    expect(screen.getByTestId("button-gusto-verify-funding")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("button-gusto-test-deposits"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/gusto/funding-account/test-deposits", expect.objectContaining({ method: "POST" })));
  });

  it("fills a demo company with sample data and lists what's left", async () => {
    const fallback = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => url === "/api/gusto/demo-company/sample-data"
      ? Promise.resolve(jsonResponse({ results: [
        { step: "Company address", status: "done" },
        { step: "Industry", status: "failed", detail: "Gusto 422 invalid_attribute_value (naics_code)" },
        { step: "Sign documents", status: "manual", detail: "Review and sign with Complete company setup" },
      ] }))
      : fallback(url, init));
    queryClient.setQueryData(["/api/gusto/status"], {
      configured: true, available: true, companyId: "company-1", environment: "demo", onboardingComplete: false,
    });
    queryClient.setQueryData(["/api/gusto/payroll-runs"], { runs: [] });
    queryClient.setQueryData(["/api/gusto/employees/readiness"], { employees: [] });
    render(
      <QueryClientProvider client={queryClient}>
        <GustoPayrollWorkspace records={[]} period={null} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTestId("button-gusto-sample-data"));
    const results = await screen.findByTestId("gusto-sample-results");
    expect(results).toHaveTextContent("✓ Company address");
    expect(results).toHaveTextContent("✕ Industry — failed: Gusto 422 invalid_attribute_value (naics_code)");
    expect(results).toHaveTextContent("→ Sign documents — still needed: Review and sign with Complete company setup");
  });

  it("adds and links the sample employees, showing readiness", async () => {
    const fallback = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => url === "/api/gusto/demo-company/sample-employees"
      ? Promise.resolve(jsonResponse({ results: [
        { step: "Gusto employees", status: "done", detail: "Sample employees already on file; direct deposit set" },
        { step: "JobsOxo employees", status: "done", detail: "Added 2" },
        { step: "Link and check readiness", status: "done", detail: "2 of 2 ready for payroll" },
      ] }))
      : fallback(url, init));
    queryClient.setQueryData(["/api/gusto/status"], { configured: true, available: true, companyId: "company-1", environment: "demo", onboardingComplete: true });
    queryClient.setQueryData(["/api/gusto/payroll-runs"], { runs: [] });
    queryClient.setQueryData(["/api/gusto/employees/readiness"], { employees: [] });
    render(
      <QueryClientProvider client={queryClient}>
        <GustoPayrollWorkspace records={[]} period={null} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTestId("button-gusto-sample-employees"));
    const results = await screen.findByTestId("gusto-sample-employee-results");
    expect(results).toHaveTextContent("✓ Link and check readiness: 2 of 2 ready for payroll");
  });

  it("shows each Gusto setup task as done (green) or to do (red)", async () => {
    queryClient.setQueryData(["/api/gusto/status"], {
      configured: true, available: true, companyId: "company-1", environment: "demo", onboardingComplete: true,
      fundingAccount: { id: "bank-1", status: "awaiting_deposits" },
    });
    queryClient.setQueryData(["/api/gusto/payroll-runs"], { runs: [] });
    queryClient.setQueryData(["/api/gusto/employees/readiness"], { employees: [
      { id: "e1", name: "Alexander Hamilton", ready: true, gustoEmployeeId: "g1" },
      { id: "e2", name: "Maria Lopez", ready: false, gustoEmployeeId: "g2", blockers: ["Gusto onboarding is incomplete"] },
    ] });
    render(
      <QueryClientProvider client={queryClient}>
        <GustoPayrollWorkspace records={[]} period={null} />
      </QueryClientProvider>,
    );

    const state = (type: string) => screen.getByTestId(`checklist-${type}`);
    await screen.findByTestId("gusto-setup-checklist");
    expect(state("company_onboarding")).toHaveAttribute("data-state", "done");
    expect(state("company_onboarding")).toHaveTextContent("Done");
    expect(state("add_bank_info")).toHaveAttribute("data-state", "done");
    expect(state("verify_bank_info")).toHaveAttribute("data-state", "todo");
    expect(state("verify_bank_info")).toHaveTextContent("To do");
    expect(state("add_employees")).toHaveAttribute("data-state", "done");
    expect(state("employee_management")).toHaveAttribute("data-state", "todo");
    // Tools that aren't tasks stay as plain buttons.
    expect(screen.getByRole("button", { name: "Gusto payroll history" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Gusto payroll" })).toBeInTheDocument();
  });

  it("never offers simulated deposits outside demo", async () => {
    queryClient.setQueryData(["/api/gusto/status"], {
      configured: true, available: true, companyId: "company-1", environment: "production", onboardingComplete: true,
      fundingAccount: { id: "bank-1", status: "awaiting_deposits" },
    });
    queryClient.setQueryData(["/api/gusto/payroll-runs"], { runs: [] });
    queryClient.setQueryData(["/api/gusto/employees/readiness"], { employees: [] });
    render(
      <QueryClientProvider client={queryClient}>
        <GustoPayrollWorkspace records={[]} period={null} />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("button-gusto-verify-funding")).toBeInTheDocument();
    expect(screen.queryByTestId("button-gusto-test-deposits")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-gusto-sample-data")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-gusto-sample-employees")).not.toBeInTheDocument();
  });

  it("hides setup steps that are already done", async () => {
    queryClient.setQueryData(["/api/gusto/status"], {
      configured: true, available: true, companyId: "company-1", environment: "demo", onboardingComplete: true,
      fundingAccount: { id: "bank-1", status: "verified" },
    });
    queryClient.setQueryData(["/api/gusto/payroll-runs"], { runs: [] });
    queryClient.setQueryData(["/api/gusto/employees/readiness"], { employees: [] });
    render(
      <QueryClientProvider client={queryClient}>
        <GustoPayrollWorkspace records={[]} period={null} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: "Sync readiness" })).toBeInTheDocument();
    expect(screen.queryByTestId("button-gusto-complete-setup")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-gusto-verify-funding")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-gusto-test-deposits")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-gusto-sample-data")).not.toBeInTheDocument();
  });

  it("rejects unapproved Gusto subdomains for hosted flows", async () => {
    flowUrl = "https://accounts.gusto.com/flows/company-onboarding";
    queryClient.setQueryData(["/api/gusto/status"], { configured: true, available: true, companyId: "company-1" });
    queryClient.setQueryData(["/api/gusto/payroll-runs"], { runs: [] });
    queryClient.setQueryData(["/api/gusto/employees/readiness"], { employees: [] });
    render(
      <QueryClientProvider client={queryClient}>
        <GustoPayrollWorkspace records={[]} period={null} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Open Complete company setup" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/gusto/flows", expect.objectContaining({ method: "POST" })));
    expect(screen.queryByTitle("Complete company setup")).not.toBeInTheDocument();
  });

  it("requires explicit confirmation before submitting the exact reviewed timestamp", async () => {
    const readyRun = {
      id: "run-ready", status: "ready_for_review", updatedAt: "2040-01-14T12:34:56.000Z",
      canCancel: false, canSubmit: true, canRecalculate: true, periodStart: "2040-01-01", periodEnd: "2040-01-14",
      employees: [{ id: "employee-1", name: "Jane Worker", hours: 40, earnings: 1200, taxes: null, netPay: null }],
    };
    runList = { runs: [readyRun] };
    detailRun = readyRun;
    queryClient.setQueryData(["/api/gusto/status"], { configured: true, available: true, companyId: "company-1" });
    queryClient.setQueryData(["/api/gusto/payroll-runs"], runList);
    queryClient.setQueryData(["/api/gusto/payroll-runs", "run-ready"], readyRun);
    queryClient.setQueryData(["/api/gusto/employees/readiness"], { employees: [{ id: "employee-1", ready: true }] });
    render(
      <QueryClientProvider client={queryClient}>
        <GustoPayrollWorkspace records={[]} period={null} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByText("Gusto payroll history (1)"));
    fireEvent.click(await screen.findByRole("button", { name: /ready_for_review/ }));
    expect(await screen.findByText(/Gusto has not supplied all employee-level tax and net values yet/)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Submit reviewed totals to Gusto" }));
    expect(await screen.findByRole("heading", { name: "Submit reviewed payroll to Gusto?" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/gusto/payroll-runs/run-ready/submit" && init?.method === "POST")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Confirm and submit to Gusto" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/gusto/payroll-runs/run-ready/submit",
      expect.objectContaining({ method: "POST" }),
    ));
    const submitRequest = fetchMock.mock.calls.find(([url, init]) => url === "/api/gusto/payroll-runs/run-ready/submit" && init?.method === "POST");
    expect(JSON.parse(String(submitRequest?.[1]?.body))).toEqual({ reviewedUpdatedAt: readyRun.updatedAt });
  });

  it("allows only reconciliation and provider-authorized cancellation while submitted", async () => {
    const submittedRun = {
      id: "run-submitted", status: "submitted", updatedAt: "2040-01-14T12:34:56.000Z",
      canCancel: true, canSubmit: false, canRecalculate: false, periodStart: "2040-01-01", periodEnd: "2040-01-14",
    };
    runList = { runs: [submittedRun] };
    detailRun = submittedRun;
    queryClient.setQueryData(["/api/gusto/status"], { configured: true, available: true, companyId: "company-1" });
    queryClient.setQueryData(["/api/gusto/payroll-runs"], runList);
    queryClient.setQueryData(["/api/gusto/payroll-runs", "run-submitted"], submittedRun);
    queryClient.setQueryData(["/api/gusto/employees/readiness"], { employees: [] });
    render(
      <QueryClientProvider client={queryClient}>
        <GustoPayrollWorkspace records={[]} period={null} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByText("Gusto payroll history (1)"));
    fireEvent.click(await screen.findByRole("button", { name: /submitted/ }));
    expect(await screen.findByRole("button", { name: "Reconcile Gusto status" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel Gusto run" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Calculate with Gusto" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit reviewed totals to Gusto" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel Gusto run" }));
    expect(await screen.findByRole("heading", { name: "Cancel this Gusto payroll run?" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/gusto/payroll-runs/run-submitted/cancel" && init?.method === "POST")).toBe(false);
  });

  it("allows Gusto-authorized recalculation after failure, without enabling submission", async () => {
    const failedRun = {
      id: "run-failed", status: "failed", updatedAt: "2040-01-14T12:34:56.000Z",
      canCancel: false, canSubmit: false, canRecalculate: true, periodStart: "2040-01-01", periodEnd: "2040-01-14",
    };
    runList = { runs: [failedRun] };
    detailRun = failedRun;
    queryClient.setQueryData(["/api/gusto/status"], { configured: true, available: true, companyId: "company-1" });
    queryClient.setQueryData(["/api/gusto/payroll-runs"], runList);
    queryClient.setQueryData(["/api/gusto/payroll-runs", "run-failed"], failedRun);
    queryClient.setQueryData(["/api/gusto/employees/readiness"], { employees: [] });
    render(
      <QueryClientProvider client={queryClient}>
        <GustoPayrollWorkspace records={[]} period={null} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByText("Gusto payroll history (1)"));
    fireEvent.click(await screen.findByRole("button", { name: /failed/ }));
    expect(await screen.findByRole("button", { name: "Calculate with Gusto" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Submit reviewed totals to Gusto" })).not.toBeInTheDocument();
  });
});