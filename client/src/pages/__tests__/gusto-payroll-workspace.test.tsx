// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GustoPayrollWorkspace } from "@/pages/payroll";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Gusto payroll workspace", () => {
  let queryClient: QueryClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url === "/api/gusto/payroll-runs") {
        return Promise.resolve(jsonResponse({
          id: "run-1",
          status: "draft",
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
      if (url === "/api/gusto/status") {
        return Promise.resolve(jsonResponse({ configured: true, state: "connected", bankConnected: true }));
      }
      if (url === "/api/gusto/bank-summary") {
        return Promise.resolve(jsonResponse({
          connected: true,
          institutionName: "Test Bank",
          accountMask: "1234",
          current: 10000,
          available: 10000,
          refreshedAt: "2040-01-14T00:00:00.000Z",
          transactions: [],
        }));
      }
      if (url === "/api/gusto/employees/readiness") {
        return Promise.resolve(jsonResponse({
          employees: [{ id: "employee-1", name: "Jane Worker", ready: true, blockers: [] }],
        }));
      }
      if (typeof url === "string" && url.startsWith("/api/gusto/payroll-runs/")) {
        return Promise.resolve(jsonResponse({ id: "run-1", status: "draft", employees: [] }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  it("renders pay date, enables creation after entry, and sends nonzero employee inputs", async () => {
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
    }] as any;

    queryClient.setQueryData(["/api/gusto/status"], { configured: true, state: "connected", bankConnected: true });
    queryClient.setQueryData(["/api/gusto/bank-summary"], {
      connected: true,
      institutionName: "Test Bank",
      accountMask: "1234",
      current: 10000,
      available: 10000,
      refreshedAt: "2040-01-14T00:00:00.000Z",
      transactions: [],
    });
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
    const create = await screen.findByRole("button", { name: "Create payroll review" });
    expect(payDate).toBeInTheDocument();
    expect(create).toBeDisabled();

    fireEvent.change(payDate, { target: { value: "2040-01-18" } });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/gusto/payroll-runs",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const request = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/gusto/payroll-runs" && init?.method === "POST",
    );
    expect(request).toBeTruthy();
    const payload = JSON.parse(String(request?.[1]?.body));
    expect(payload).toMatchObject({
      periodStart: "2040-01-01",
      periodEnd: "2040-01-14",
      payDate: "2040-01-18",
    });
    expect(payload.items).toEqual([expect.objectContaining({
      employeeId: "employee-1",
      hours: 40,
      grossEarnings: 1200,
      deductions: 100,
    })]);
  });
});