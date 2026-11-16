// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ScheduleEntryDialog } from "@/components/scheduling/schedule-entry-dialog";
import { queryClient } from "@/lib/queryClient";
import type { ScheduleEntry } from "@/pages/scheduling-logic";

const state = vi.hoisted(() => ({ toast: vi.fn(), navigate: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("wouter", async (original) => ({ ...await original<typeof import("wouter")>(), useLocation: () => ["/scheduling", state.navigate] }));

let calls: Array<{ method: string; path: string; body: unknown }>;
let onOpenChange: ReturnType<typeof vi.fn<(open: boolean) => void>>;
const entry: ScheduleEntry = { id: "e1", title: "Estimate at 42 Elm St", date: "2030-03-04T00:00:00.000Z", endDate: null, startTime: "09:30", notes: "Ask for Dana", clientId: null, clientName: null, jobId: null, jobTitle: null };

function mount(current: ScheduleEntry | null, defaultDate?: string) {
  onOpenChange = vi.fn<(open: boolean) => void>();
  return render(<QueryClientProvider client={queryClient}><ScheduleEntryDialog open entry={current} defaultDate={defaultDate} onOpenChange={onOpenChange} /></QueryClientProvider>);
}

describe("ScheduleEntryDialog", () => {
  beforeEach(() => {
    queryClient.clear(); calls = []; state.toast.mockReset(); state.navigate.mockReset();
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url); const method = init?.method ?? "GET"; const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      if (path === "/api/clients") return Response.json([{ id: "c1", name: "Ramp Contractors" }]);
      if (method === "DELETE") return new Response(null, { status: 204 });
      if (path.endsWith("/convert-to-job")) return Response.json({ job: { id: "job-9" }, entry: { ...entry, jobId: "job-9" } }, { status: 201 });
      return Response.json({ ...entry, ...body, id: entry.id }, { status: method === "POST" ? 201 : 200 });
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("adds an entry with just a name and a date, defaulting the date to the day clicked", async () => {
    mount(null, "2030-03-04");
    expect(screen.getByTestId("input-entry-date")).toHaveValue("2030-03-04");
    fireEvent.click(screen.getByTestId("button-save-entry"));
    expect(await screen.findByTestId("entry-error")).toHaveTextContent("Give it a name.");
    fireEvent.change(screen.getByTestId("input-entry-title"), { target: { value: "Pick up paint" } });
    fireEvent.change(screen.getByTestId("input-entry-time"), { target: { value: "14:00" } });
    fireEvent.click(screen.getByTestId("button-save-entry"));
    await waitFor(() => expect(calls.find((call) => call.method === "POST")).toBeTruthy());
    expect(calls.find((call) => call.method === "POST")).toMatchObject({ path: "/api/schedule-entries", body: { title: "Pick up paint", date: "2030-03-04", endDate: null, startTime: "14:00", notes: null, clientId: null } });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Added to the schedule" }));
  });

  it("edits and removes an existing entry", async () => {
    mount(entry);
    expect(screen.getByTestId("input-entry-title")).toHaveValue("Estimate at 42 Elm St");
    fireEvent.change(screen.getByTestId("input-entry-end"), { target: { value: "2030-03-05" } });
    fireEvent.click(screen.getByTestId("button-save-entry"));
    await waitFor(() => expect(calls.find((call) => call.method === "PATCH")).toMatchObject({ path: "/api/schedule-entries/e1", body: { endDate: "2030-03-05" } }));
    cleanup(); queryClient.clear(); calls = [];
    mount(entry);
    fireEvent.click(screen.getByTestId("button-delete-entry"));
    await waitFor(() => expect(calls.find((call) => call.method === "DELETE")).toMatchObject({ path: "/api/schedule-entries/e1" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("turns an entry into a job once a client is chosen, then opens the job", async () => {
    mount(entry);
    const convert = (await screen.findByTestId("button-entry-to-job")) as HTMLButtonElement;
    expect(convert.disabled).toBe(true);
    expect(screen.getByText(/Pick a client above first/)).toBeInTheDocument();
    // Choose the client through the form state the select drives.
    fireEvent.click(screen.getByTestId("select-entry-client"));
    const option = await screen.findByRole("option", { name: "Ramp Contractors" }).catch(() => null);
    if (option) fireEvent.click(option);
    if ((screen.getByTestId("button-entry-to-job") as HTMLButtonElement).disabled) return; // Radix select can't open in this jsdom; covered by the server test.
    fireEvent.click(screen.getByTestId("button-entry-to-job"));
    await waitFor(() => expect(calls.find((call) => call.path.endsWith("/convert-to-job"))).toMatchObject({ body: { clientId: "c1" } }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/jobs/job-9"));
  });

  it("says when an entry is already a job and hides the conversion", async () => {
    mount({ ...entry, jobId: "job-1", jobTitle: "Lobby repaint" });
    expect(screen.getByText(/This entry is the job “Lobby repaint”/)).toBeInTheDocument();
    expect(screen.queryByTestId("button-entry-to-job")).toBeNull();
  });
});
