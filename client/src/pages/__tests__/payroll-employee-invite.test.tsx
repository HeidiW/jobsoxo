// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Payroll from "../payroll";

const { toast, apiRequest } = vi.hoisted(() => ({ toast: vi.fn(), apiRequest: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/components/payroll/gusto-bank-view", () => ({ default: () => <section aria-label="Independent bank balance view" /> }));
vi.mock("@/components/payroll/gusto-payroll-workspace", () => ({ default: () => <section aria-label="Gusto payroll workspace" /> }));
vi.mock("@/lib/queryClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queryClient")>()),
  apiRequest,
}));

// jsdom has no ResizeObserver; Radix components measure with it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let client: QueryClient;
let gustoConnected: boolean;

function show() {
  client = new QueryClient({
    defaultOptions: { queries: {
      retry: false,
      queryFn: async ({ queryKey }) => {
        if (queryKey[0] === "/api/gusto/status") return gustoConnected ? { companyId: "company-1", configured: true } : { configured: false };
        return queryKey[0] === "/api/settings" ? {} : [];
      },
    } },
  });
  render(<QueryClientProvider client={client}><Payroll /></QueryClientProvider>);
}

async function openForm(email = "rosa@example.com") {
  fireEvent.click(await screen.findByTestId("button-add-employee"));
  fireEvent.change(await screen.findByTestId("input-employee-first-name"), { target: { value: "Rosa" } });
  fireEvent.change(screen.getByTestId("input-employee-last-name"), { target: { value: "Diaz" } });
  fireEvent.change(screen.getByTestId("input-employee-email"), { target: { value: email } });
  fireEvent.change(screen.getByTestId("input-employee-rate"), { target: { value: "240" } });
}

const posted = () => JSON.parse(JSON.stringify(apiRequest.mock.calls.find(([method, url]) => method === "POST" && url === "/api/employees")?.[2] ?? null));

describe("Add employee: invite to Gusto payroll", () => {
  beforeEach(() => {
    gustoConnected = true;
    toast.mockReset();
    apiRequest.mockReset();
  });
  afterEach(() => { cleanup(); client?.clear(); });

  it("is ticked by default for a new W-2 employee and sends the invitation", async () => {
    apiRequest.mockResolvedValue(new Response(JSON.stringify({ id: "e1", email: "rosa@example.com", gustoInvite: { status: "invited" } })));
    show();
    await openForm();

    expect(await screen.findByTestId("checkbox-invite-to-gusto")).toBeChecked();
    fireEvent.click(screen.getByTestId("button-save-employee"));

    await waitFor(() => expect(posted()).toMatchObject({ name: "Rosa Diaz", firstName: "Rosa", lastName: "Diaz", inviteToGusto: true }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      title: "Employee added and invited to Gusto", description: "Gusto emailed rosa@example.com to enter their tax and bank details.",
    }));
  });

  it("can be unticked", async () => {
    apiRequest.mockResolvedValue(new Response(JSON.stringify({ id: "e1" })));
    show();
    await openForm();

    fireEvent.click(await screen.findByTestId("checkbox-invite-to-gusto"));
    fireEvent.click(screen.getByTestId("button-save-employee"));

    await waitFor(() => expect(posted()).toMatchObject({ inviteToGusto: false }));
  });

  it("needs an email address to invite", async () => {
    show();
    await openForm("");

    fireEvent.click(screen.getByTestId("button-save-employee"));

    expect(await screen.findByText("Email is required to invite to Gusto payroll")).toBeInTheDocument();
    expect(posted()).toBeNull();
  });

  it("says so when the employee was saved but the invitation failed", async () => {
    apiRequest.mockResolvedValue(new Response(JSON.stringify({ id: "e1", gustoInvite: { status: "failed", error: "Add the company address in Gusto before inviting employees." } })));
    show();
    await openForm();

    fireEvent.click(screen.getByTestId("button-save-employee"));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Employee added, but the Gusto invitation failed", variant: "destructive",
    })));
  });

  it("isn't offered when Gusto isn't connected", async () => {
    gustoConnected = false;
    show();
    await openForm();

    expect(screen.queryByTestId("checkbox-invite-to-gusto")).not.toBeInTheDocument();
  });
});
