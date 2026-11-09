// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { GetOnItList, dayLabel, localDay } from "@/components/todos/get-on-it";
import { queryClient } from "@/lib/queryClient";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

let rows: Array<Record<string, unknown>>;
let calls: Array<{ method: string; url: string; body?: any }>;
const todo = (id: string, text: string, dueDate: string | null, done = false) =>
  ({ id, text, dueDate, done, doneAt: done ? "2026-11-09T10:00:00Z" : null, createdAt: "2026-11-01T00:00:00Z" });

function mount(shownDays: string[] = []) {
  return render(<QueryClientProvider client={queryClient}><GetOnItList shownDays={shownDays} /></QueryClientProvider>);
}

describe("GetOnItList", () => {
  beforeEach(() => {
    queryClient.clear();
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === "GET") return Response.json(rows);
      if (method === "PATCH") {
        const id = url.split("/").pop();
        rows = rows.map((row) => row.id === id ? { ...row, ...JSON.parse(String(init?.body)) } : row);
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ id: "new" }, { status: method === "POST" ? 201 : 200 });
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("formats calendar days without shifting them", () => {
    expect(dayLabel("2026-11-09")).toBe("Mon 9 Nov");
    expect(localDay(new Date(2026, 10, 9, 23, 30))).toBe("2026-11-09");
  });

  it("lists items with no day, overdue items, and days not on screen; leaves on-screen days to their columns", async () => {
    rows = [
      todo("a", "Order primer", "2026-11-10"),
      todo("b", "Call the supplier", null),
      todo("c", "Return the sprayer", "2020-01-06"),
    ];
    mount(["2026-11-10"]);
    const list = await screen.findByTestId("get-on-it-list");
    expect(list).toHaveTextContent("Call the supplier");
    expect(list).not.toHaveTextContent("Order primer");
    expect(screen.getByTestId("todo-day-c")).toHaveTextContent("was due Mon 6 Jan");
  });

  it("adds a to-do with an optional day and clears the box", async () => {
    rows = [];
    mount();
    expect(await screen.findByTestId("get-on-it-empty")).toHaveTextContent("Nothing on the list");
    fireEvent.change(screen.getByTestId("input-new-todo"), { target: { value: "  Buy caulk " } });
    fireEvent.change(screen.getByTestId("input-new-todo-day"), { target: { value: "2026-11-12" } });
    fireEvent.click(screen.getByTestId("button-add-todo"));
    await waitFor(() => expect(calls.find((call) => call.method === "POST")).toMatchObject({ url: "/api/todos", body: { text: "Buy caulk", dueDate: "2026-11-12" } }));
    await waitFor(() => expect(screen.getByTestId("input-new-todo")).toHaveValue(""));
  });

  it("ticks an item off straight away and deletes items", async () => {
    rows = [todo("b", "Call the supplier", null)];
    mount();
    const box = await screen.findByTestId("checkbox-todo-b");
    fireEvent.click(box);
    await waitFor(() => expect(screen.getByTestId("checkbox-todo-b")).toBeChecked());
    await waitFor(() => expect(calls.find((call) => call.method === "PATCH")).toMatchObject({ url: "/api/todos/b", body: { done: true } }));
    fireEvent.click(screen.getByTestId("button-delete-todo-b"));
    await waitFor(() => expect(calls.some((call) => call.method === "DELETE" && call.url === "/api/todos/b")).toBe(true));
  });
});
