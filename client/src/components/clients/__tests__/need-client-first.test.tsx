// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { NeedClientFirst } from "@/components/clients/need-client-first";
import { queryClient } from "@/lib/queryClient";

let clients: unknown;
let status: number;

function mount() {
  return render(
    <QueryClientProvider client={queryClient}>
      <NeedClientFirst context="jobs"><p data-testid="usual-empty">No jobs yet</p></NeedClientFirst>
    </QueryClientProvider>,
  );
}

describe("NeedClientFirst", () => {
  beforeEach(() => {
    queryClient.clear();
    clients = [];
    status = 200;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(clients, { status })));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("replaces the usual empty state with the client step when there are no clients", async () => {
    mount();
    const state = await screen.findByTestId("need-client-first");
    expect(state).toHaveTextContent("Jobs belong to a client");
    expect(screen.getByTestId("button-add-first-client")).toHaveAttribute("href", "/clients?new=1");
    expect(screen.queryByTestId("usual-empty")).toBeNull();
  });

  it("leaves the usual empty state alone once a client exists", async () => {
    clients = [{ id: "c1", name: "Northline" }];
    mount();
    await waitFor(() => expect(queryClient.getQueryData(["/api/clients"])).toBeTruthy());
    expect(screen.getByTestId("usual-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("need-client-first")).toBeNull();
  });

  it("never takes over when the client list can't be loaded", async () => {
    status = 500;
    clients = { error: "down" };
    mount();
    await waitFor(() => expect(queryClient.getQueryState(["/api/clients"])?.status).toBe("error"));
    expect(screen.getByTestId("usual-empty")).toBeInTheDocument();
  });
});
