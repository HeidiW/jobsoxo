// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PayrollWorksheet from "@/pages/payroll-worksheet";

const historicWorksheet = {
  id: "worksheet-history-1",
  employeeId: "employee-1",
  periodStart: "2040-01-01",
  periodEnd: "2040-01-14",
  payDate: "2040-01-18",
  daysWorked: "5",
  dailyGross: "240",
  grossPay: "1200",
  gustoDeductionsBreakdown: [],
  totalDeductions: "0",
  netPay: "1200",
  status: "confirmed",
  gustoConfirmationReference: "GUS-4821",
  gustoConfirmedAt: "2040-01-18T14:30:00.000Z",
  gustoConfirmationNotes: "Reference retained from the original audit record.",
};

describe("Payroll worksheet history", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows prior confirmation metadata read-only and preserves local CSV export access", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queryClient.setQueryData(["/api/employees"], [{
      id: "employee-1", name: "Jane Worker", status: "active", dayRate: "240",
    }]);
    queryClient.setQueryData(["/api/payroll-worksheets"], [historicWorksheet]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(historicWorksheet), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    let downloaded: Blob | null = null;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => { downloaded = blob; return "blob:worksheet-export"; }),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(
      <QueryClientProvider client={queryClient}>
        <PayrollWorksheet />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /2040-01-01 – 2040-01-14/ }));
    expect(screen.getByRole("heading", { name: "Gusto confirmation history" })).toBeInTheDocument();
    expect(screen.getByText("GUS-4821")).toBeInTheDocument();
    expect(screen.getByText("2040-01-18")).toBeInTheDocument();
    expect(screen.getByText("Reference retained from the original audit record.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record Gusto confirmation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /confirmation reference/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/payroll-worksheets/worksheet-history-1/export",
      expect.objectContaining({ method: "POST" }),
    ));
    await waitFor(() => expect(downloaded).not.toBeNull());
    expect(await downloaded!.text()).toContain('"Local reference worksheet",""');
  });
});
