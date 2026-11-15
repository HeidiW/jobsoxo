// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import JobForm from "@/components/job-form";
import { queryClient } from "@/lib/queryClient";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/components/address-autocomplete", () => ({ AddressAutocomplete: () => <input aria-label="Address" /> }));
// The client form itself is covered elsewhere; here we only care that the job
// form opens it and selects whatever it saves.
vi.mock("@/components/clients/client-form", () => ({
  ClientForm: ({ onSaved, onClose }: { onSaved?: (client: { id: string; name: string }) => void; onClose: () => void }) => (
    <button type="button" onClick={() => { onSaved?.({ id: "c-new", name: "Brand New Builders" }); onClose(); }}>Save stub client</button>
  ),
}));

let clients: { id: string; name: string }[];
const pointerMethods = ["hasPointerCapture", "setPointerCapture", "releasePointerCapture", "scrollIntoView"];
const descriptors = new Map<string, PropertyDescriptor | undefined>();

function mount() {
  return render(<QueryClientProvider client={queryClient}><JobForm onSuccess={() => {}} onClose={() => {}} /></QueryClientProvider>);
}

describe("JobForm: add a client in place", () => {
  beforeAll(() => {
    pointerMethods.forEach((method) => {
      descriptors.set(method, Object.getOwnPropertyDescriptor(HTMLElement.prototype, method));
      Object.defineProperty(HTMLElement.prototype, method, { configurable: true, value: method === "hasPointerCapture" ? () => false : () => {} });
    });
  });
  afterAll(() => pointerMethods.forEach((method) => {
    const descriptor = descriptors.get(method);
    if (descriptor) Object.defineProperty(HTMLElement.prototype, method, descriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, method);
  }));
  beforeEach(() => {
    queryClient.clear();
    clients = [];
    vi.stubGlobal("PointerEvent", MouseEvent);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url) === "/api/clients") return Response.json(clients);
      return Response.json([]);
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("explains the dependency when there are no clients and selects the client added from the picker", async () => {
    mount();
    expect(await screen.findByTestId("hint-no-clients")).toHaveTextContent("Jobs belong to a client");
    await userEvent.click(screen.getByTestId("select-job-client"));
    await userEvent.click(await screen.findByRole("option", { name: /Add a client/ }));
    const dialog = await screen.findByTestId("dialog-add-client");
    expect(dialog).toBeInTheDocument();
    fireEvent.click(screen.getByText("Save stub client"));
    await waitFor(() => expect(screen.queryByTestId("dialog-add-client")).toBeNull());
    await waitFor(() => expect(screen.getByTestId("select-job-client")).toHaveTextContent("Brand New Builders"));
  });

  it("keeps the option available when clients already exist", async () => {
    clients = [{ id: "c1", name: "Northline Builders" }];
    mount();
    await waitFor(() => expect(queryClient.getQueryData(["/api/clients"])).toBeTruthy());
    expect(screen.queryByTestId("hint-no-clients")).toBeNull();
    await userEvent.click(screen.getByTestId("select-job-client"));
    expect(await screen.findByRole("option", { name: /Add a client/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "Northline Builders" }));
    await waitFor(() => expect(screen.getByTestId("select-job-client")).toHaveTextContent("Northline Builders"));
  });
});
