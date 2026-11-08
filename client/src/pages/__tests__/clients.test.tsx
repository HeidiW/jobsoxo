// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Clients from "../clients";
import { queryClient } from "@/lib/queryClient";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/components/address-autocomplete", async () => {
  const { forwardRef } = await import("react");
  type Props = React.InputHTMLAttributes<HTMLInputElement> & {
    onAddressSelect: (value: { streetAddress: string; formattedAddress: string; city: string; state: string; postalCode: string }) => void;
  };
  return {
    AddressAutocomplete: forwardRef<HTMLInputElement, Props>(({ onAddressSelect, ...props }, ref) => (
      <>
        <input {...props} ref={ref} />
        <button type="button" onClick={() => onAddressSelect({
          streetAddress: "12 Test Street", formattedAddress: "12 Test Street, New York",
          city: "New York", state: "NY", postalCode: "10001",
        })}>Choose test address</button>
      </>
    )),
  };
});

const initialRecords = [
  { id: "client-1", name: "Northline Construction", generalContractorName: "Hudson Builders", email: "office@example.invalid", phone: "2125550142", address: "12 Test Street", city: "New York", state: "NY", zipCode: "10001", notes: "Existing instructions", activeJobs: 2, outstandingBalance: 1500.57 },
  { id: "client-2", name: "Harbor Plaster", generalContractorName: null, email: null, phone: null, address: null, city: null, state: null, zipCode: null, notes: null, activeJobs: 0, outstandingBalance: 0 },
];
let records: typeof initialRecords;
let fetchMock: ReturnType<typeof vi.fn>;
let loadFailed: boolean;
let saveFailed: boolean;
let deleteFailed: boolean;
function mount() {
  return render(<QueryClientProvider client={queryClient}><Clients /></QueryClientProvider>);
}
async function ready() { await screen.findByTestId("row-client-client-1"); }
async function openMenu(id = "client-1") { await userEvent.click(screen.getByTestId(`button-client-actions-${id}`)); }
function writes(method: string) { return fetchMock.mock.calls.filter(([, init]) => init?.method === method); }
function change(id: string, value: string) { fireEvent.change(screen.getByTestId(id), { target: { value } }); }

describe("Clients redesign", () => {
  beforeEach(() => {
    queryClient.clear(); toast.mockReset(); records = structuredClone(initialRecords);
    loadFailed = false; saveFailed = false; deleteFailed = false;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/clients" && (!init?.method || init.method === "GET")) {
        return loadFailed ? Response.json({ error: "Unavailable" }, { status: 503 }) : Response.json(records);
      }
      if (init?.method === "POST" || init?.method === "PATCH") {
        if (saveFailed) return Response.json({ error: "Check client", details: { name: ["Client name needs correction"] } }, { status: 400 });
        const values = JSON.parse(init.body as string);
        const client = { ...initialRecords[1], ...values, id: init.method === "POST" ? "client-new" : path.split("/").pop() };
        records = init.method === "POST" ? [...records, client] : records.map((record) => record.id === client.id ? { ...record, ...client } : record);
        return Response.json(client);
      }
      if (init?.method === "DELETE") {
        if (deleteFailed) return Response.json({ error: "Cannot delete" }, { status: 500 });
        records = records.filter((record) => record.id !== path.split("/").pop());
        return new Response(null, { status: 204 });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { queryClient.clear(); vi.unstubAllGlobals(); });

  it("uses actual card data, preserves currency cents and links to scoped jobs and new invoices", async () => {
    mount(); await ready();
    const card = screen.getByTestId("row-client-client-1");
    expect(card).toHaveTextContent("Hudson Builders");
    expect(card).toHaveTextContent("office@example.invalid");
    expect(card).toHaveTextContent("12 Test Street");
    expect(within(card).getByTestId("outstanding-client-1")).toHaveTextContent("$1,500.57");
    expect(within(card).getByTestId("jobs-count-client-1")).toHaveTextContent("2");
    expect(screen.getByTestId("button-view-jobs-client-1")).toHaveAttribute("href", "/jobs?clientId=client-1");
    expect(screen.getByTestId("button-create-invoice-client-1")).toHaveAttribute("href", "/invoices/new?clientId=client-1");
    expect(screen.getByRole("heading", { name: "Clients" })).toHaveClass("!font-bold");
  });

  it("searches without confusing no matches with an empty client list", async () => {
    mount(); await ready();
    change("input-search-clients", "  OFFICE@EXAMPLE.INVALID  ");
    expect(screen.getByTestId("row-client-client-1")).toBeInTheDocument();
    expect(screen.queryByTestId("row-client-client-2")).not.toBeInTheDocument();
    change("input-search-clients", "no match");
    expect(screen.queryByTestId("row-client-client-1")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No matching clients" })).toBeInTheDocument();
    change("input-search-clients", "");
    expect(screen.getByTestId("row-client-client-2")).toBeInTheDocument();
  });

  it("creates a client with populated address fields and preserves form validation", async () => {
    mount(); await ready();
    await userEvent.click(screen.getByTestId("button-add-client"));
    await userEvent.click(screen.getByTestId("button-save-client"));
    expect(await screen.findByText("Client name is required")).toBeInTheDocument();
    expect(writes("POST")).toHaveLength(0);
    change("input-client-name", "New Example Client");
    change("input-client-gc-name", "Example GC");
    change("input-client-email", "new@example.invalid");
    change("input-client-notes", "Site contact instructions");
    await userEvent.click(screen.getByRole("button", { name: "Choose test address" }));
    await userEvent.click(screen.getByTestId("button-save-client"));
    await screen.findByTestId("row-client-client-new");
    expect(JSON.parse(writes("POST")[0][1].body as string)).toMatchObject({
      name: "New Example Client", generalContractorName: "Example GC", email: "new@example.invalid",
      address: "12 Test Street", city: "New York", state: "NY", zipCode: "10001", notes: "Site contact instructions",
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("saves additional emails for company contacts", async () => {
    mount(); await ready();
    await userEvent.click(screen.getByTestId("button-add-client"));
    change("input-client-name", "Northline Construction");
    change("input-client-email", "main@northline.test");

    for (const email of ["ap@northline.test", "pm@northline.test"]) {
      change("client-additional-emails-input", email);
      await userEvent.click(screen.getByTestId("client-additional-emails-add"));
    }
    // The primary email can't be repeated as an additional one.
    change("client-additional-emails-input", "MAIN@northline.test");
    await userEvent.click(screen.getByTestId("client-additional-emails-add"));
    expect(await screen.findByText("That email is already listed")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("client-additional-emails-remove-pm@northline.test"));

    await userEvent.click(screen.getByTestId("button-save-client"));
    await waitFor(() => expect(writes("POST")).toHaveLength(1));
    expect(JSON.parse(writes("POST")[0][1].body as string)).toMatchObject({
      email: "main@northline.test", additionalEmails: ["ap@northline.test"],
    });
  });

  it("prefills edit, keeps field errors and edits on save failure, then persists the correction", async () => {
    mount(); await ready(); await openMenu();
    await userEvent.click(screen.getByTestId("button-edit-client-client-1"));
    expect(screen.getByTestId("input-client-name")).toHaveValue("Northline Construction");
    expect(screen.getByTestId("input-client-notes")).toHaveValue("Existing instructions");
    change("input-client-name", "Northline Updated"); saveFailed = true;
    await userEvent.click(screen.getByTestId("button-save-client"));
    expect(await screen.findByText("Client name needs correction")).toBeInTheDocument();
    expect(screen.getByTestId("input-client-name")).toHaveValue("Northline Updated");
    saveFailed = false;
    await userEvent.click(screen.getByTestId("button-save-client"));
    await waitFor(() => expect(screen.getByTestId("row-client-client-1")).toHaveTextContent("Northline Updated"));
    expect(writes("PATCH")[0][0]).toBe("/api/clients/client-1");
  });

  it("requires explicit destructive confirmation, supports cancel and retains failed delete confirmation", async () => {
    mount(); await ready(); await openMenu();
    await userEvent.click(screen.getByTestId("button-delete-client-client-1"));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(/associated|jobs.*invoices/i);
    expect(writes("DELETE")).toHaveLength(0);
    await userEvent.click(screen.getByTestId("button-cancel-delete-client"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await openMenu();
    await userEvent.click(screen.getByTestId("button-delete-client-client-1")); deleteFailed = true;
    await userEvent.click(screen.getByTestId("button-confirm-delete-client"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to delete client" })));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    deleteFailed = false;
    await userEvent.click(screen.getByTestId("button-confirm-delete-client"));
    await waitFor(() => expect(screen.queryByTestId("row-client-client-1")).not.toBeInTheDocument());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("distinguishes a failed load from an empty list and recovers via retry", async () => {
    loadFailed = true; mount();
    const alert = await screen.findByRole("alert");
    expect(screen.queryByTestId("button-add-first-client")).not.toBeInTheDocument();
    loadFailed = false;
    await userEvent.click(within(alert).getByRole("button", { name: /retry|try again/i }));
    await ready();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a working add-client action for an actually empty list", async () => {
    records = []; mount();
    await userEvent.click(await screen.findByTestId("button-add-first-client"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("input-client-name")).toHaveValue("");
  });
});
