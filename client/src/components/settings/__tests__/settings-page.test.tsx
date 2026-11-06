// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import SettingsPage from "@/pages/settings";
import { queryClient } from "@/lib/queryClient";

const toastMock = vi.fn();
let mockUser: { isAdmin: boolean; displayName: string } = { isAdmin: false, displayName: "Rae" };

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mockUser }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/hooks/use-plaid-link", () => ({
  usePlaidLink: () => ({ open: vi.fn(), isLoading: false }),
}));

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Settings page", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let failSettingsLoad: boolean;
  let failCompanySave: boolean;
  let failReminderSave: boolean;
  let plaidConfigured: boolean;
  let bankConnected: boolean;
  let patches: Array<{ url: string; body: Record<string, unknown> }>;
  let settingsData: Record<string, unknown>;
  let profilePatches: Array<Record<string, unknown>>;

  beforeEach(() => {
    mockUser = { isAdmin: false, displayName: "Rae" };
    toastMock.mockReset();
    queryClient.clear();
    failSettingsLoad = false;
    failCompanySave = false;
    failReminderSave = false;
    plaidConfigured = false;
    bankConnected = false;
    patches = [];
    profilePatches = [];
    settingsData = {
      companyName: "Northstar Finish Co.",
      companyEmail: "office@example.test",
      companyPhone: "(212) 555-0100",
      companyAddress: "18 Orchard Street",
      taxRate: "8.875",
      invoicePrefix: "NS",
      invoiceTerms: "Due within 30 days.",
      inboxSyncHour: 8,
      collectionsEnabled: true,
      reminderIntervals: [5, 11, 27],
      reminderTones: [
        { stage: 1, label: "Gentle nudge", subject: "A", body: "B" },
        { stage: 2, label: "Second request", subject: "C", body: "D" },
        { stage: 3, label: "Final notice", subject: "E", body: "F" },
      ],
      lastInboxSync: null,
    };
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/settings" && (!init?.method || init.method === "GET")) {
        return failSettingsLoad
          ? response({ error: "Settings unavailable" }, 503)
          : response(settingsData);
      }
      if (url === "/api/settings" && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patches.push({ url, body });
        if (body.collectionsEnabled !== undefined && failReminderSave) {
          return response({ error: "Reminder save rejected" }, 500);
        }
        if (body.companyName !== undefined && failCompanySave) {
          return response({ error: "Save rejected" }, 500);
        }
        settingsData = { ...settingsData, ...body };
        return response(settingsData);
      }
      if (url === "/api/plaid/status") return response({ configured: plaidConfigured });
      if (url === "/api/plaid/bank-account?entityType=business") {
        return response(bankConnected ? {
          id: "bank-1",
          institutionName: "First Demo Bank",
          accountName: "Operating",
          accountMask: "4421",
        } : null);
      }
      if (url === "/api/plaid/balance") return response({ connected: true, current: 1200, available: 900 });
      if (url === "/api/plaid/transactions") return response({
        lastSynced: null,
        transactions: [
          { id: "tx-open", plaidTransactionId: "plaid-open", date: "2026-05-01", amount: "22", name: "Supply House" },
          { id: "tx-matched", plaidTransactionId: "plaid-matched", date: "2026-05-02", amount: "-80", name: "Client payment", matchedPaymentId: "payment-1", matchedInvoiceNumber: "NS-104" },
        ],
      });
      if (url === "/api/sms/config") return response({ phoneNumber: null });
      if (url === "/api/invites") return response([]);
      if (url === "/api/auth/profile" && init?.method === "PATCH") {
        profilePatches.push(JSON.parse(String(init.body)));
        return response({});
      }
      return response({});
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.unstubAllGlobals();
  });

  function mount() {
    return render(
      <QueryClientProvider client={queryClient}>
        <SettingsPage />
      </QueryClientProvider>,
    );
  }

  it("loads the company first, validates email, and saves the existing settings payload", async () => {
    mockUser = { isAdmin: true, displayName: "Rae" };
    mount();
    expect(await screen.findByDisplayValue("Northstar Finish Co.")).toBeInTheDocument();
    expect(screen.getByText("Company Information")).toBeInTheDocument();
    expect(screen.getByText("Your Profile")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-company-email"), { target: { value: "not-an-email" } });
    fireEvent.submit(screen.getByTestId("input-company-email").closest("form")!);
    expect(await screen.findByText("Invalid email")).toBeInTheDocument();
    expect(patches).toHaveLength(0);

    fireEvent.change(screen.getByTestId("input-company-email"), { target: { value: "billing@example.test" } });
    fireEvent.click(screen.getByTestId("button-save-settings"));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].body).toMatchObject({
      companyName: "Northstar Finish Co.",
      companyEmail: "billing@example.test",
      companyPhone: "(212) 555-0100",
      companyAddress: "18 Orchard Street",
      invoicePrefix: "NS",
      taxRate: 8.875,
      inboxSyncHour: 8,
    });
  });

  it("shows configured custom reminder chips and keeps chip/template saves out of the company form", async () => {
    mockUser = { isAdmin: true, displayName: "Rae" };
    mount();
    expect(await screen.findByTestId("reminder-chip-1")).toHaveTextContent("5 days");
    expect(screen.getByTestId("reminder-chip-2")).toHaveTextContent("11 days");
    expect(screen.getByTestId("reminder-chip-3")).toHaveTextContent("27 days");
    expect(screen.getByTestId("reminder-chip-1")).toHaveTextContent("Gentle nudge");
    fireEvent.click(screen.getByTestId("reminder-chip-2"));
    expect(await screen.findByTestId("input-tone-subject-2")).toHaveValue("C");
    expect(screen.getByTestId("button-expand-tone-2")).toHaveTextContent("Second request");
    expect(screen.getByTestId("reminder-chip-2")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("input-tone-subject-2").closest("form")).toBeNull();

    fireEvent.change(screen.getByTestId("input-reminder-interval-1"), { target: { value: "9" } });
    fireEvent.change(screen.getByTestId("input-tone-subject-2"), { target: { value: "Edited draft" } });
    fireEvent.keyDown(screen.getByTestId("input-tone-subject-2"), { key: "Enter", code: "Enter" });
    expect(patches).toHaveLength(0);

    fireEvent.click(screen.getByTestId("button-save-settings"));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(screen.getByTestId("input-reminder-interval-1")).toHaveValue(9);
    expect(screen.getByTestId("input-tone-subject-2")).toHaveValue("Edited draft");

    fireEvent.click(screen.getByTestId("button-save-collections-settings"));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1].body).toMatchObject({
      collectionsEnabled: true,
      reminderIntervals: [9, 11, 27],
      reminderTones: [
        expect.objectContaining({ stage: 1, label: "Gentle nudge" }),
        expect.objectContaining({ stage: 2, label: "Second request", subject: "Edited draft" }),
        expect.objectContaining({ stage: 3, label: "Final notice" }),
      ],
    });
    expect(screen.getByTestId("button-sync-now")).toBeInTheDocument();
    expect(screen.getByTestId("button-create-invite")).toBeInTheDocument();
  });

  it("offers retry for load failures and reports save failures without changing the draft", async () => {
    mockUser = { isAdmin: true, displayName: "Rae" };
    failSettingsLoad = true;
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Settings could not be loaded");
    failSettingsLoad = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByDisplayValue("Northstar Finish Co.")).toBeInTheDocument();

    failCompanySave = true;
    fireEvent.click(screen.getByTestId("button-save-settings"));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Error saving settings",
      variant: "destructive",
    })));
    expect(screen.getByDisplayValue("Northstar Finish Co.")).toBeInTheDocument();
  });

  it("retains reminder edits after a failed reminder save", async () => {
    mockUser = { isAdmin: true, displayName: "Rae" };
    failReminderSave = true;
    mount();
    fireEvent.change(await screen.findByTestId("input-reminder-interval-1"), { target: { value: "8" } });
    fireEvent.click(screen.getByTestId("button-expand-tone-3"));
    fireEvent.change(await screen.findByTestId("input-tone-subject-3"), { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByTestId("button-save-collections-settings"));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      title: "Failed to save",
      variant: "destructive",
    })));
    expect(screen.getByTestId("input-reminder-interval-1")).toHaveValue(8);
    expect(screen.getByTestId("input-tone-subject-3")).toHaveValue("Keep this draft");
  });

  it("keeps business mutation controls disabled for non-admins while profile save stays independent", async () => {
    plaidConfigured = true;
    bankConnected = true;
    mount();
    await screen.findByDisplayValue("Northstar Finish Co.");
    expect(screen.getByTestId("input-company-name")).toBeDisabled();
    expect(screen.getByTestId("button-save-settings")).toBeDisabled();
    expect(screen.getByTestId("input-reminder-interval-1")).toBeDisabled();
    expect(screen.getByTestId("button-save-collections-settings")).toBeDisabled();
    expect(await screen.findByTestId("button-disconnect-bank")).toBeDisabled();
    expect(await screen.findByTestId("button-link-tx-tx-open")).toBeDisabled();
    expect(screen.getByTestId("button-sync-transactions")).toBeDisabled();
    expect(screen.getByTestId("button-unlink-tx-tx-matched")).toBeDisabled();
    expect(screen.queryByTestId("input-inbox-sync-hour")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-sync-now")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-create-invite")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-company-name"), { target: { value: "Attempted non-admin edit" } });
    fireEvent.submit(screen.getByTestId("input-company-name").closest("form")!);
    expect(patches).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Rae Builder" } });
    fireEvent.keyDown(screen.getByLabelText("Your name"), { key: "Enter", code: "Enter" });
    await waitFor(() => expect(profilePatches).toEqual([{ displayName: "Rae Builder" }]));
    expect(patches).toHaveLength(0);
  });

  it("associates external invoice and schedule fields with the company form", async () => {
    mockUser.isAdmin = true;
    mount();
    await screen.findByDisplayValue("Northstar Finish Co.");
    const companyForm = screen.getByTestId("input-company-name").closest("form");
    expect(screen.getByRole("textbox", { name: "Email" })).toBe(screen.getByTestId("input-company-email"));
    expect(screen.getByRole("textbox", { name: "Phone" })).toBe(screen.getByTestId("input-company-phone"));
    for (const id of ["input-invoice-prefix", "input-tax-rate", "input-invoice-terms", "input-inbox-sync-hour"]) {
      const field = screen.getByTestId(id) as HTMLInputElement | HTMLTextAreaElement;
      expect(field.form).toBe(companyForm);
    }
    fireEvent.click(screen.getByTestId("reminder-chip-2"));
    const template = await screen.findByTestId("input-tone-subject-2") as HTMLInputElement;
    expect(template.form).toBeNull();
  });

  it("does not offer non-admins an active Plaid connection action", async () => {
    plaidConfigured = true;
    mount();
    expect(await screen.findByTestId("button-connect-bank")).toBeDisabled();
    fireEvent.click(screen.getByTestId("button-connect-bank"));
    expect(fetchMock.mock.calls.some(([url, init]) => typeof url === "string" && url.startsWith("/api/plaid") && init?.method === "POST")).toBe(false);
  });
});
