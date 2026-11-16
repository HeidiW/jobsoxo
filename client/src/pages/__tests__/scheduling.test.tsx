// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { addDays, addMonths, format, startOfWeek } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Scheduling from "../scheduling";
import { queryClient } from "@/lib/queryClient";

vi.mock("@/components/job-form", () => ({
  default: ({ job, onSuccess, onClose }: { job: { id: string }; onSuccess: () => void; onClose: () => void }) =>
    <div data-testid="existing-job-editor">{job.id}<button onClick={onSuccess}>Finish editing</button><button onClick={onClose}>Cancel editing</button></div>,
}));
const today = new Date();
const monday = startOfWeek(today, { weekStartsOn: 1 });
const date = (offset: number) => format(addDays(monday, offset), "yyyy-MM-dd");
const base = { clientId: "client-a", client: { name: "Hotel client" }, assignedEmployees: [{ id: "crew-a", name: "Assigned crew" }], endDate: null };
const initialJobs = [
  { ...base, id: "scheduled", title: "Scheduled restoration", status: "scheduled", startDate: date(0), endDate: date(4) },
  { ...base, id: "weekend", title: "Weekend finish", status: "in_progress", startDate: date(5), endDate: date(6) },
  { ...base, id: "ongoing", title: "Gramercy bars", status: "in_progress", startDate: date(-10), endDate: null },
  { ...base, id: "quoted", title: "Quoted plaster", status: "quoted", startDate: null },
  { ...base, id: "undated", title: "Awaiting dates", status: "scheduled", startDate: null },
  { ...base, id: "completed", title: "Completed job", status: "completed", startDate: date(0) },
];
let jobs: typeof initialJobs;
let entries: Array<Record<string, unknown>>;
const initialEntries = [
  { id: "e1", title: "Estimate at 42 Elm St", date: `${date(1)}T00:00:00.000Z`, endDate: null, startTime: "09:30", notes: "Ask for Dana", clientId: null, clientName: null, jobId: null, jobTitle: null },
  { id: "e2", title: "Saturday pickup", date: `${date(5)}T00:00:00.000Z`, endDate: null, startTime: null, notes: null, clientId: null, clientName: null, jobId: null, jobTitle: null },
];
let unavailable: boolean;
let fetchMock: ReturnType<typeof vi.fn>;
function mount() { render(<QueryClientProvider client={queryClient}><Scheduling /></QueryClientProvider>); }
async function ready() { await screen.findByTestId("job-block-scheduled"); }

describe("Scheduling redesign", () => {
  beforeEach(() => {
    queryClient.clear(); jobs = structuredClone(initialJobs); entries = structuredClone(initialEntries); unavailable = false;
    fetchMock = vi.fn(async (path: string) => path.startsWith("/api/schedule-entries") ? Response.json(entries) : path === "/api/notes/current" ? Response.json({ id: "note-1", createdAt: "2026-11-09T14:00:00.000Z", items: [{ id: "i1", text: "Order primer", done: false, doneAt: null, doneByName: null, position: 0 }] }) : unavailable ? Response.json({ error: "Unavailable" }, { status: 503 }) : Response.json(jobs));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { queryClient.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("shows ten weekday headers, real job crew and links, and preserves weekend-only work", async () => {
    mount(); await ready();
    expect(screen.getAllByTestId(/^scheduling-date-/)).toHaveLength(10);
    expect(screen.getByTestId(`scheduling-date-${date(0)}`)).toBeVisible();
    expect(screen.getByTestId("job-block-scheduled")).toHaveAttribute("href", "/jobs/scheduled");
    expect(screen.getByTestId("job-block-scheduled")).toHaveTextContent("Assigned crew");
    expect(screen.getByTestId("job-block-scheduled")).toHaveClass("border-l-[6px]");
    expect(screen.getByTestId("weekend-job-weekend")).toHaveTextContent("Weekend finish");
    expect(screen.getByTestId("weekend-job-weekend")).toHaveAttribute("href", "/jobs/weekend");
    expect(screen.getByTestId("backlog-job-quoted")).toBeVisible();
    expect(screen.getByTestId("backlog-job-undated")).toBeVisible();
    expect(screen.queryByText("Completed job")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([path]) => path === "/api/jobs" || path === "/api/notes/current" || String(path).startsWith("/api/schedule-entries?"))).toBe(true);
    if (today.getDay() !== 0 && today.getDay() !== 6) {
      expect(screen.getByTestId(`scheduling-date-${format(today, "yyyy-MM-dd")}`)).toHaveAttribute("aria-current", "date");
    }
  });

  it("moves by complete fortnights and resets to this week", async () => {
    mount(); await ready();
    await userEvent.click(screen.getByTestId("button-next-period"));
    expect(screen.getByTestId(`scheduling-date-${date(14)}`)).toBeVisible();
    expect(screen.getByTestId("scheduling-empty")).toBeVisible();
    await userEvent.click(screen.getByTestId("button-prev-period"));
    expect(screen.getByTestId("job-block-scheduled")).toBeVisible();
    await userEvent.click(screen.getByTestId("button-prev-period"));
    expect(screen.getByTestId(`scheduling-date-${date(-14)}`)).toBeVisible();
    await userEvent.click(screen.getByTestId("button-today"));
    expect(screen.getByTestId(`scheduling-date-${date(0)}`)).toBeVisible();
    expect(screen.getByTestId("button-today")).toHaveTextContent("This week");
  });

  it("retains the full month calendar, weekends and monthly navigation", async () => {
    mount(); await ready();
    await userEvent.click(screen.getByTestId("button-view-month"));
    const weekend = within(screen.getByTestId(`month-cell-${date(5)}`));
    expect(weekend.getByTestId("month-job-weekend")).toHaveAttribute("href", "/jobs/weekend");
    expect(screen.getByTestId("scheduling-month-scroll")).toHaveClass("relative", "overflow-x-auto");
    await userEvent.click(screen.getByTestId("button-next-period"));
    expect(screen.getByTestId("button-today")).toHaveTextContent(format(addMonths(today, 1), "MMM yyyy"));
    await userEvent.click(screen.getByTestId("button-today"));
    expect(screen.getByTestId("button-today")).toHaveTextContent(format(today, "MMM yyyy"));
    await userEvent.click(screen.getByTestId("button-view-week"));
    expect(screen.getByTestId("job-block-scheduled")).toBeVisible();
  });

  it("opens the existing job editor from Pick dates with focus and Escape handling", async () => {
    mount(); await ready();
    await userEvent.click(screen.getByTestId("button-pick-dates-quoted"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByTestId("existing-job-editor")).toHaveTextContent("quoted");
    expect(dialog).toHaveAccessibleName("Quoted plaster");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-pick-dates-undated"));
    await userEvent.click(screen.getByRole("button", { name: "Finish editing" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("replaces the placeholder crew action with a working job chooser and editor", async () => {
    mount(); await ready();
    await userEvent.click(screen.getByTestId("button-assign-crew"));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Choose a job");
    expect(screen.queryByTestId("button-choose-job-completed")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-choose-job-scheduled"));
    expect(screen.getByTestId("existing-job-editor")).toHaveTextContent("scheduled");
    await userEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows recoverable errors in both views without pretending jobs are absent", async () => {
    unavailable = true; mount();
    await screen.findByRole("alert");
    expect(screen.queryByTestId("scheduling-empty")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("button-view-month"));
    expect(screen.getByRole("alert")).toHaveTextContent("didn’t load");
    expect(screen.queryByTestId("scheduling-month-scroll")).not.toBeInTheDocument();
    unavailable = false;
    await userEvent.click(screen.getByTestId("button-retry-schedule"));
    await screen.findByTestId("scheduling-month-scroll");
    await userEvent.click(screen.getByTestId("button-view-week"));
    await ready();
  });

  it("explains an empty schedule and empty job chooser", async () => {
    entries = [];
    jobs = []; mount();
    expect(await screen.findByTestId("scheduling-empty")).toHaveTextContent("No active jobs");
    expect(screen.getByTestId("schedule-backlog-empty")).toBeVisible();
    await userEvent.click(screen.getByTestId("button-assign-crew"));
    expect(screen.getByRole("dialog")).toHaveTextContent("There are no active jobs to assign.");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the team's Get on it notepad under the calendar", async () => {
    mount();
    expect(await screen.findByTestId("text-i1")).toHaveTextContent("Order primer");
    expect(screen.getByTestId("input-new-item")).toBeInTheDocument();
  });

  it("shows schedule entries beside jobs, in the weekend note, and in month view", async () => {
    mount(); await ready();
    const block = await screen.findByTestId("entry-block-e1");
    expect(block).toHaveTextContent("9:30 AM · Estimate at 42 Elm St");
    expect(screen.getByTestId("schedule-entry-row-e1")).toHaveTextContent("Not a job yet");
    expect(screen.getByTestId("weekend-entry-e2")).toHaveTextContent("Saturday pickup");
    await userEvent.click(screen.getByTestId("button-view-month"));
    expect(await screen.findByTestId("month-entry-e1")).toHaveTextContent("Estimate at 42 Elm St");
  });

  it("opens the entry dialog from the header, from a month day, and from an existing entry", async () => {
    mount(); await ready();
    await userEvent.click(screen.getByTestId("button-add-schedule-entry"));
    expect(await screen.findByTestId("schedule-entry-dialog")).toHaveTextContent("Add to the schedule");
    await userEvent.click(screen.getByTestId("button-cancel-entry"));
    await userEvent.click(await screen.findByTestId("entry-block-e1"));
    expect(await screen.findByTestId("input-entry-title")).toHaveValue("Estimate at 42 Elm St");
    await userEvent.click(screen.getByTestId("button-cancel-entry"));
    await userEvent.click(screen.getByTestId("button-view-month"));
    await userEvent.click(await screen.findByTestId(`button-add-entry-${date(2)}`));
    expect(await screen.findByTestId("input-entry-date")).toHaveValue(date(2));
  });

  it("keeps the calendar when there are entries but no jobs", async () => {
    jobs = jobs.filter((job) => job.status === "quoted");
    mount();
    expect(await screen.findByTestId("entry-block-e1")).toBeInTheDocument();
    expect(screen.queryByTestId("scheduling-empty")).toBeNull();
  });

  it("shows a job in progress with no end date as ongoing instead of hiding it after its first day", async () => {
    mount(); await ready();
    expect(screen.getByTestId("job-block-ongoing")).toHaveTextContent("ongoing, no end date");
    expect(screen.queryByTestId("backlog-job-ongoing")).toBeNull();
  });
});
