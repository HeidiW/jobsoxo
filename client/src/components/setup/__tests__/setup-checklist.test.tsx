// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { SetupChecklist, setupSteps, type SetupStatus } from "@/components/setup/setup-checklist";
import { queryClient } from "@/lib/queryClient";

const auth = vi.hoisted(() => ({ user: { id: "u1", isAdmin: true } as { id: string; isAdmin: boolean } | null }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: auth.user }) }));

let status: SetupStatus;
let posts: string[];

function mount() {
  return render(<QueryClientProvider client={queryClient}><SetupChecklist /></QueryClientProvider>);
}

describe("SetupChecklist", () => {
  beforeEach(() => {
    queryClient.clear();
    posts = [];
    auth.user = { id: "u1", isAdmin: true };
    status = { companyDetails: true, clients: 0, jobs: 0, invoices: 0, dismissed: false, complete: false };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") { posts.push(String(url)); status = { ...status, dismissed: true }; }
      return Response.json(status);
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("orders the steps with clients before jobs", () => {
    expect(setupSteps(status).map((step) => step.key)).toEqual(["company", "client", "job", "invoice"]);
    expect(setupSteps(status).find((step) => step.key === "client")?.href).toBe("/clients?new=1");
  });

  it("shows progress, ticks what's done and points at the next step", async () => {
    mount();
    const card = await screen.findByTestId("setup-checklist");
    expect(card).toHaveTextContent("1 of 4 done");
    expect(screen.getByTestId("setup-step-company")).toHaveAttribute("data-done", "true");
    expect(screen.getByTestId("setup-step-client")).toHaveAttribute("data-done", "false");
    expect(screen.getByRole("link", { name: /Add your first client/ })).toHaveAttribute("href", "/clients?new=1");
    expect(card).toHaveTextContent("Jobs and invoices belong to a client, so this comes first.");
  });

  it("hides itself when every step is done or it was dismissed, and shows nothing on an unexpected response", async () => {
    status = { ...status, clients: 1, jobs: 1, invoices: 1, complete: true };
    mount();
    await waitFor(() => expect(queryClient.getQueryData(["/api/setup/status"])).toBeTruthy());
    expect(screen.queryByTestId("setup-checklist")).toBeNull();
    cleanup(); queryClient.clear();

    status = { ...status, complete: false, dismissed: true };
    mount();
    await waitFor(() => expect(queryClient.getQueryData(["/api/setup/status"])).toBeTruthy());
    expect(screen.queryByTestId("setup-checklist")).toBeNull();
    cleanup(); queryClient.clear();

    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
    mount();
    await waitFor(() => expect(queryClient.getQueryData(["/api/setup/status"])).toBeTruthy());
    expect(screen.queryByTestId("setup-checklist")).toBeNull();
  });

  it("lets an admin hide it for everyone; others don't get the button", async () => {
    mount();
    fireEvent.click(await screen.findByTestId("button-dismiss-setup"));
    await waitFor(() => expect(posts).toEqual(["/api/setup/dismiss"]));
    await waitFor(() => expect(screen.queryByTestId("setup-checklist")).toBeNull());
    cleanup(); queryClient.clear();

    auth.user = { id: "u2", isAdmin: false };
    status = { ...status, dismissed: false };
    mount();
    await screen.findByTestId("setup-checklist");
    expect(screen.queryByTestId("button-dismiss-setup")).toBeNull();
  });
});
