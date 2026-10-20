// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import Payroll from "../payroll";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/payroll/gusto-bank-view", () => ({
  default: () => <section aria-label="Independent bank balance view" />,
}));
vi.mock("@/components/payroll/gusto-payroll-workspace", () => ({
  default: () => <section aria-label="Gusto payroll workspace" />,
}));

let client: QueryClient;
afterEach(() => { cleanup(); client?.clear(); });

function show(fails: () => boolean) {
  client = new QueryClient({
    defaultOptions: { queries: {
      retry: false,
      queryFn: async ({ queryKey }) => {
        if (queryKey[0] === "/api/payroll-records" && fails()) throw new Error("History unavailable");
        return queryKey[0] === "/api/settings" ? {} : [];
      },
    } },
  });
  render(<QueryClientProvider client={client}><Payroll /></QueryClientProvider>);
}

describe("Payroll presentation", () => {
  it("shows an unavailable history warning and retries without blocking Gusto", async () => {
    let fails = true;
    show(() => fails);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load or refresh local payroll history");
    expect(screen.getByRole("region", { name: "Gusto payroll workspace" })).toBeInTheDocument();
    expect(screen.queryByText("No local payroll records yet")).not.toBeInTheDocument();
    fails = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry loading local payroll history" }));
    await screen.findByText("No local payroll records yet");
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("keeps empty local summaries distinct from provider totals and preserves section controls", async () => {
    show(() => false);
    await screen.findByText("No local payroll records yet");
    expect(screen.getByTestId("stat-net")).toHaveTextContent("—");
    expect(screen.getByText(/Gusto calculates actual payroll amounts and payment status/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark.*paid|confirm.*funding/i })).toBeNull();
    for (const name of ["employees", "time", "smslog", "settings"]) {
      fireEvent.click(screen.getByTestId(`tab-${name}`));
      expect(screen.getByTestId(`tab-${name}`)).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("tab-payroll")).toHaveAttribute("aria-pressed", "false");
    }
    fireEvent.click(screen.getByTestId("tab-payroll"));
    expect(screen.getByRole("region", { name: "Independent bank balance view" })).toBeInTheDocument();
  });
});
