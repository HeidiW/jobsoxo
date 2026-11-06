// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GustoBankView from "../gusto-bank-view";

const { openBank } = vi.hoisted(() => ({ openBank: vi.fn() }));
vi.mock("@/hooks/use-plaid-link", () => ({
  usePlaidLink: () => ({ open: openBank, isLoading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

describe("Independent payroll bank view", () => {
  let client: QueryClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    openBank.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    client.clear();
    vi.unstubAllGlobals();
  });

  function show() {
    return render(
      <QueryClientProvider client={client}><GustoBankView /></QueryClientProvider>,
    );
  }

  function reply(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("shows the real current balance and only the latest ten transactions", async () => {
    fetchMock.mockResolvedValue(reply({
      connected: true, institutionName: "Test bank", current: 0,
      transactions: Array.from({ length: 12 }, (_, i) => ({
        id: String(i), date: `2026-10-${String(i + 1).padStart(2, "0")}`,
        name: `Transfer ${i + 1}`, amount: i + 1,
      })),
    }));
    show();
    await screen.findByText("Test bank");
    expect(screen.getByText("$0.00")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    const transactions = screen.getAllByText(/^Transfer \d+$/);
    expect(transactions).toHaveLength(10);
    expect(transactions[0]).toHaveTextContent("Transfer 12");
    expect(transactions[9]).toHaveTextContent("Transfer 3");
    expect(screen.queryByText("Transfer 1")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([url]) => url === "/api/plaid/bank-summary")).toBe(true);
  });

  it("reports bank failure without suggesting payroll or manual funding is blocked", async () => {
    fetchMock.mockResolvedValue(reply({ error: "Unavailable" }, 503));
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Gusto payroll remains available independently",
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect bank view" }));
    expect(openBank).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /confirm funding|mark paid/i })).toBeNull();
  });

  it("refreshes real balances and preserves the stale-data warning", async () => {
    fetchMock.mockResolvedValueOnce(reply({
      connected: true, current: 100, available: 75,
      refreshedAt: "2026-10-19T12:00:00Z", stale: true,
    })).mockResolvedValue(reply({ connected: true, current: 200, available: 150 }));
    show();
    await screen.findByText("$100.00");
    expect(screen.getByText(/data may be stale/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh read-only bank view" }));
    await screen.findByText("$200.00");
    await waitFor(() => expect(screen.queryByText(/data may be stale/)).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("$150.00")).toBeInTheDocument();
  });
});
