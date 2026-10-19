// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Jobs from "../jobs";

const route = vi.hoisted(() => ({ search: "", navigate: vi.fn() }));
vi.mock("wouter", async (original) => ({
  ...await original<typeof import("wouter")>(),
  useSearch: () => route.search,
  useLocation: () => ["/jobs", route.navigate],
}));

vi.mock("@/components/jobs-list-thumbnail", () => ({
  default: ({ title }: { title: string }) => <div aria-label={`Thumbnail for ${title}`} />,
}));

vi.mock("@/components/job-form", () => ({
  default: ({ job }: { job?: { title: string } }) => (
    <div data-testid="mock-job-form">{job ? `Editing ${job.title}` : "Creating a job"}</div>
  ),
}));

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const records = [
  {
    id: "job-quoted",
    clientId: "client-1",
    title: "Rear deck rebuild",
    description: "",
    address: "12 Willow Street",
    status: "quoted",
    squareFootage: "480",
    startDate: null,
    endDate: null,
    estimatedTotal: "18650",
    referenceCodes: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    client: { id: "client-1", name: "Mara Chen" },
  },
  {
    id: "job-progress",
    clientId: "client-2",
    title: "Storefront repaint",
    description: "",
    address: "Queens",
    status: "in_progress",
    squareFootage: null,
    startDate: null,
    endDate: null,
    estimatedTotal: null,
    referenceCodes: [],
    createdAt: "2026-01-02T00:00:00.000Z",
    client: { id: "client-2", name: "Northline Market" },
  },
];

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderJobs(queryFn: () => Promise<typeof records> = async () => records) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryFn, retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Jobs />
    </QueryClientProvider>,
  );
}

async function openActions(jobTitle = "Rear deck rebuild") {
  const row = await screen.findByTestId(jobTitle === "Rear deck rebuild" ? "row-job-job-quoted" : "row-job-job-progress");
  await userEvent.click(within(row).getByRole("button", { name: `Actions for ${jobTitle}` }));
  return row;
}

describe("Jobs list actions and filters", () => {
  beforeEach(() => {
    route.search = "";
    route.navigate.mockReset();
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") return jsonResponse(null, 204);
      if (url === "/api/jobs") {
        return jsonResponse(records);
      }
      if (url.endsWith("/documents")) {
        return jsonResponse([]);
      }
      return jsonResponse({ error: "not found" }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows only the selected client's jobs, scopes counts and can remove the client filter", async () => {
    route.search = "clientId=client-2";
    renderJobs();
    expect(await screen.findByTestId("row-job-job-progress")).toBeInTheDocument();
    expect(screen.queryByTestId("row-job-job-quoted")).not.toBeInTheDocument();
    expect(screen.getByTestId("job-client-filter")).toHaveTextContent("Northline Market");
    expect(screen.getByTestId("text-visible-job-count")).toHaveTextContent("Showing 1 of 1 jobs");
    await userEvent.click(screen.getByTestId("button-clear-client-filter"));
    expect(route.navigate).toHaveBeenCalledWith("/jobs");
  });

  it("shows the quoted filter count and filters by status and searchable fields", async () => {
    renderJobs();
    await screen.findByTestId("row-job-job-quoted");
    const header = screen.getByTestId("jobs-table").querySelector(".grid")!;
    expect(Array.from(header.children).map((cell) => cell.textContent)).toEqual([
      "Document", "Job", "Dates", "Status", "Estimate", "Progress", "Actions",
    ]);
    // Visually hidden labels need an in-flow wrapper to keep their grid
    // columns; sr-only directly on a grid child would shift every heading.
    expect(Array.from(header.children).every((cell) => !cell.classList.contains("sr-only"))).toBe(true);
    expect(screen.getByTestId("filter-tab-quoted")).toHaveTextContent("Quoted1");

    fireEvent.click(screen.getByTestId("filter-tab-quoted"));
    expect(screen.getByTestId("row-job-job-quoted")).toBeInTheDocument();
    expect(screen.queryByTestId("row-job-job-progress")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("filter-tab-all"));
    fireEvent.change(screen.getByTestId("input-search-jobs"), { target: { value: "northline" } });
    expect(screen.getByTestId("row-job-job-progress")).toBeInTheDocument();
    expect(screen.queryByTestId("row-job-job-quoted")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByTestId("row-job-job-quoted")).toBeInTheDocument();
    expect(screen.getByTestId("row-job-job-progress")).toBeInTheDocument();
  });

  it("shows an explicit load error and retries without presenting a false empty list", async () => {
    const query = vi.fn()
      .mockRejectedValueOnce(new Error("Temporary connection failure"))
      .mockResolvedValue(records);
    renderJobs(query);
    expect(await screen.findByRole("heading", { name: "Jobs didn’t load" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No jobs yet" })).not.toBeInTheDocument();
    expect(screen.getByTestId("text-jobs-subtitle")).toHaveTextContent("Your job list is unavailable");
    await userEvent.click(screen.getByTestId("button-retry-jobs"));
    expect(await screen.findByTestId("row-job-job-quoted")).toBeInTheDocument();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("opens create and edit dialogs using the existing job form", async () => {
    renderJobs();
    await screen.findByTestId("row-job-job-quoted");

    fireEvent.click(screen.getByTestId("button-add-job"));
    expect(screen.getByRole("heading", { name: "New job" })).toBeInTheDocument();
    expect(screen.getByTestId("mock-job-form")).toHaveTextContent("Creating a job");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "New job" })).not.toBeInTheDocument());
    await openActions();
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(screen.getByRole("heading", { name: "Edit job" })).toBeInTheDocument();
    expect(screen.getByTestId("mock-job-form")).toHaveTextContent("Editing Rear deck rebuild");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/jobs/job-quoted", expect.anything());
  });

  it("keeps all action destinations available and confirms before issuing a mocked delete", async () => {
    renderJobs();
    await openActions();
    expect(screen.getByRole("menuitem", { name: /View details/ })).toHaveAttribute("href", "/jobs/job-quoted");
    expect(screen.getByRole("menuitem", { name: /Line items/ })).toHaveAttribute("href", "/jobs/job-quoted/line-items");
    expect(screen.getByRole("menuitem", { name: /New invoice/ })).toHaveAttribute("href", "/invoices/new?jobId=job-quoted");

    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("all associated invoices, line items, and documents");
    expect(fetchMock.mock.calls.some(([url, init]) => init?.method === "DELETE" && String(url).includes("/api/jobs/"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Keep job" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, init]) => init?.method === "DELETE" && String(url).includes("/api/jobs/"))).toBe(false);

    await openActions();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByTestId("button-confirm-delete-job"));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url, init]) => init?.method === "DELETE" && String(url) === "/api/jobs/job-quoted")).toBe(true);
    });
  });
});
