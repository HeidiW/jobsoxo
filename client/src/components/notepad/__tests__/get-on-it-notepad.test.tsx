// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { GetOnItNotepad, type CurrentNote, type NoteItem } from "@/components/notepad/get-on-it-notepad";
import { queryClient } from "@/lib/queryClient";

let current: CurrentNote;
let archived: Array<{ id: string; title: string | null; createdAt: string; archivedAt: string; archivedByName: string | null; items: NoteItem[] }>;
let calls: Array<{ method: string; path: string; body: unknown }>;
let nextId = 1;

const item = (text: string, done = false): NoteItem => ({ id: `i${nextId++}`, text, done, doneAt: done ? "2026-11-09T15:00:00.000Z" : null, doneByName: done ? "Heidi" : null, position: nextId });

function mount() {
  return render(<QueryClientProvider client={queryClient}><GetOnItNotepad /></QueryClientProvider>);
}

describe("GetOnItNotepad", () => {
  beforeEach(() => {
    queryClient.clear();
    nextId = 1;
    calls = [];
    archived = [];
    current = { id: "note-1", createdAt: "2026-11-09T14:00:00.000Z", items: [item("Order primer"), item("Call the supplier", true)] };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url); const method = init?.method ?? "GET"; const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      if (path === "/api/notes/current" && method === "GET") return Response.json(current);
      if (path === "/api/notes/archive") return Response.json({ notes: archived });
      if (path === "/api/notes/current/items" && method === "POST") { const created = item(body.text); current = { ...current, items: [...current.items, created] }; return Response.json(created, { status: 201 }); }
      if (path.startsWith("/api/notes/items/") && method === "PATCH") {
        const id = path.split("/").pop()!; const existing = current.items.find((row) => row.id === id)!;
        const updated = { ...existing, ...body, doneAt: body.done === undefined ? existing.doneAt : body.done ? "2026-11-09T16:00:00.000Z" : null };
        current = { ...current, items: current.items.map((row) => (row.id === id ? updated : row)) };
        return Response.json(updated);
      }
      if (path.startsWith("/api/notes/items/") && method === "DELETE") { const id = path.split("/").pop()!; current = { ...current, items: current.items.filter((row) => row.id !== id) }; return new Response(null, { status: 204 }); }
      if (path === "/api/notes/current/archive" && method === "POST") {
        archived = [{ id: current.id, title: null, createdAt: current.createdAt, archivedAt: "2026-11-10T09:00:00.000Z", archivedByName: "Heidi", items: current.items }, ...archived];
        const carried = body.carryOverUnfinished ? current.items.filter((row) => !row.done).map((row) => item(row.text)) : [];
        current = { id: `note-${nextId++}`, createdAt: "2026-11-10T09:00:00.000Z", items: carried };
        return Response.json({ archived: true, carried: carried.length, current });
      }
      return Response.json({ error: `Unexpected ${method} ${path}` }, { status: 500 });
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows the list with done items crossed off and a running count", async () => {
    mount();
    expect(await screen.findByTestId("notepad-progress")).toHaveTextContent("1 of 2 done");
    expect(screen.getByTestId("note-item-i2")).toHaveAttribute("data-done", "true");
    expect(screen.getByTestId("text-i2")).toHaveClass("line-through");
    expect(screen.getByTestId("check-i1")).toHaveAttribute("aria-checked", "false");
  });

  it("adds an item on Enter and ticks it off", async () => {
    mount();
    await screen.findByTestId("notepad-progress");
    const input = screen.getByTestId("input-new-item");
    fireEvent.change(input, { target: { value: "Pick up drop cloths" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.path === "/api/notes/current/items")).toBe(true));
    expect(await screen.findByTestId("text-i3")).toHaveTextContent("Pick up drop cloths");
    expect(input).toHaveValue("");
    fireEvent.click(screen.getByTestId("check-i3"));
    await waitFor(() => expect(screen.getByTestId("note-item-i3")).toHaveAttribute("data-done", "true"));
    expect(calls.find((call) => call.method === "PATCH")).toMatchObject({ path: "/api/notes/items/i3", body: { done: true } });
    expect(screen.getByTestId("notepad-progress")).toHaveTextContent("2 of 3 done");
  });

  it("edits an item's wording and removes one", async () => {
    mount();
    await screen.findByTestId("notepad-progress");
    fireEvent.click(screen.getByTestId("text-i1"));
    const edit = screen.getByTestId("input-edit-i1");
    fireEvent.change(edit, { target: { value: "Order primer and tape" } });
    fireEvent.keyDown(edit, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("text-i1")).toHaveTextContent("Order primer and tape"));
    expect(calls.find((call) => call.method === "PATCH")).toMatchObject({ body: { text: "Order primer and tape" } });
    fireEvent.click(screen.getByTestId("remove-i1"));
    await waitFor(() => expect(screen.queryByTestId("note-item-i1")).toBeNull());
  });

  it("files the note in the archive on New note, carrying unfinished items over, and shows past notes", async () => {
    mount();
    await screen.findByTestId("notepad-progress");
    fireEvent.click(screen.getByTestId("button-new-note"));
    expect(screen.getByTestId("new-note-confirm")).toHaveTextContent("1 item isn't done yet");
    fireEvent.click(screen.getByTestId("button-new-note-carry"));
    await waitFor(() => expect(screen.queryByTestId("new-note-confirm")).toBeNull());
    expect(calls.find((call) => call.path === "/api/notes/current/archive")).toMatchObject({ body: { carryOverUnfinished: true } });
    await waitFor(() => expect(screen.getByTestId("notepad-progress")).toHaveTextContent("0 of 1 done"));
    expect(screen.getByText("Order primer")).toBeInTheDocument();
    expect(screen.queryByText("Call the supplier")).toBeNull();

    fireEvent.click(screen.getByTestId("button-notepad-archive"));
    const past = await screen.findByTestId("archived-note-note-1");
    expect(past).toHaveTextContent("1 of 2 done");
    expect(past).toHaveTextContent("Call the supplier");
  });

  it("disables New note on an empty list and offers only a fresh start when everything is done", async () => {
    current = { ...current, items: [] };
    mount();
    await waitFor(() => expect(queryClient.getQueryData(["/api/notes/current"])).toBeTruthy());
    expect(screen.getByTestId("button-new-note")).toBeDisabled();
    cleanup(); queryClient.clear();
    current = { ...current, items: [item("All done", true)] };
    mount();
    await screen.findByTestId("notepad-progress");
    fireEvent.click(screen.getByTestId("button-new-note"));
    expect(screen.queryByTestId("button-new-note-carry")).toBeNull();
    expect(screen.getByTestId("button-new-note-fresh")).toBeInTheDocument();
  });

  it("shows an error from the server and keeps the list", async () => {
    mount();
    await screen.findByTestId("notepad-progress");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "This note is full. Start a new note and carry the unfinished items over." }, { status: 400 })));
    const input = screen.getByTestId("input-new-item");
    fireEvent.change(input, { target: { value: "One more" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByTestId("notepad-error")).toHaveTextContent("This note is full");
    expect(screen.getByTestId("text-i1")).toBeInTheDocument();
  });
});
