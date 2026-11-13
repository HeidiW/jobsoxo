// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { GetOnItNotepad } from "@/components/notepad/get-on-it-notepad";
import { queryClient } from "@/lib/queryClient";

type Server = { content: string; updatedAt: string | null; updatedByName: string | null };
let server: Server;
let puts: Array<{ content: string; baseUpdatedAt: string | null }>;
let failSaves: boolean;
let versions: Array<{ id: string; content: string; savedAt: string; savedByName: string | null }>;
const DRAFT_KEY = "jobsoxo.notepad.get-on-it.draft";

function mount() {
  return render(<QueryClientProvider client={queryClient}><GetOnItNotepad /></QueryClientProvider>);
}
async function ready(expected = "Order primer") {
  const pad = await screen.findByTestId("input-notepad");
  await waitFor(() => expect(pad).toHaveValue(expected));
  return pad;
}

describe("GetOnItNotepad", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    queryClient.clear();
    // This jsdom has no working localStorage; the component only needs get/set/remove.
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
    });
    puts = [];
    failSaves = false;
    versions = [];
    server = { content: "Order primer", updatedAt: "2026-11-09T14:00:00.000Z", updatedByName: "Heidi" };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/versions")) return Response.json({ versions, retentionDays: 90 });
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        if (failSaves) return Response.json({ error: "Failed to save the notepad" }, { status: 500 });
        if (body.baseUpdatedAt !== server.updatedAt) {
          return Response.json({ error: "Conor saved the notepad while you were editing.", current: server }, { status: 409 });
        }
        server = { content: body.content, updatedAt: "2026-11-09T15:00:00.000Z", updatedByName: "Heidi" };
        return Response.json(server);
      }
      return Response.json(server);
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("shows the saved notes and who saved them, then saves by itself after typing stops", async () => {
    mount();
    const pad = await ready();
    expect(screen.getByTestId("notepad-status")).toHaveTextContent("by Heidi");
    expect(screen.queryByTestId("button-save-notepad")).toBeNull();

    fireEvent.change(pad, { target: { value: "Order primer\nCall the supplier" } });
    expect(screen.getByTestId("notepad-status")).toHaveTextContent("Saving soon");
    // The draft is in this browser before the server has it.
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!)).toEqual({ content: "Order primer\nCall the supplier", baseUpdatedAt: "2026-11-09T14:00:00.000Z" });
    expect(puts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1300);
    await waitFor(() => expect(screen.getByTestId("notepad-status")).toHaveTextContent("Saved Nov 9, 10:00 AM by Heidi"));
    expect(puts).toEqual([{ content: "Order primer\nCall the supplier", baseUpdatedAt: "2026-11-09T14:00:00.000Z" }]);
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("saves at once on Cmd/Ctrl+S and when the notes lose focus", async () => {
    mount();
    const pad = await ready();
    fireEvent.change(pad, { target: { value: "New note" } });
    fireEvent.keyDown(pad, { key: "s", metaKey: true });
    await waitFor(() => expect(puts).toHaveLength(1));
    fireEvent.change(pad, { target: { value: "New note, and another" } });
    fireEvent.blur(pad);
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1].content).toBe("New note, and another");
  });

  it("brings back a draft left in this browser and saves it", async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ content: "Order primer\nTyped before the refresh", baseUpdatedAt: "2026-11-09T14:00:00.000Z" }));
    mount();
    await ready("Order primer\nTyped before the refresh");
    expect(screen.getByTestId("notepad-draft-restored")).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(1300);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].content).toBe("Order primer\nTyped before the refresh");
    await waitFor(() => expect(screen.queryByTestId("notepad-draft-restored")).toBeNull());
  });

  it("ignores a stale draft written on top of notes someone has since changed", async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ content: "Old draft", baseUpdatedAt: "2026-11-01T09:00:00.000Z" }));
    mount();
    await ready("Order primer");
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(puts).toHaveLength(0);
  });

  it("keeps the notes in the browser and retries when a save fails", async () => {
    failSaves = true;
    mount();
    const pad = await ready();
    fireEvent.change(pad, { target: { value: "Keep me" } });
    await vi.advanceTimersByTimeAsync(1300);
    await waitFor(() => expect(screen.getByTestId("notepad-status")).toHaveTextContent("Not saved yet, retrying"));
    expect(screen.getByRole("alert")).toHaveTextContent("kept in this browser");
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!).content).toBe("Keep me");
    failSaves = false;
    await vi.advanceTimersByTimeAsync(5100);
    await waitFor(() => expect(screen.getByTestId("notepad-status")).toHaveTextContent("Saved"));
    expect(puts).toHaveLength(2);
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it("asks which version to keep when someone else saved first", async () => {
    mount();
    const pad = await ready();
    server = { content: "Conor's list", updatedAt: "2026-11-09T14:30:00.000Z", updatedByName: "Conor" };
    fireEvent.change(pad, { target: { value: "My list" } });
    await vi.advanceTimersByTimeAsync(1300);
    const conflict = await screen.findByTestId("notepad-conflict");
    expect(conflict).toHaveTextContent("Conor saved the notepad while you were editing.");
    expect(pad).toHaveValue("My list");
    // Autosave stays paused until the person decides.
    await vi.advanceTimersByTimeAsync(3000);
    expect(puts).toHaveLength(1);

    fireEvent.click(screen.getByTestId("button-load-theirs"));
    expect(pad).toHaveValue("Conor's list");
    expect(screen.queryByTestId("notepad-conflict")).toBeNull();
    expect(puts).toHaveLength(1);
  });

  it("keeps mine on request by saving over the other person's version", async () => {
    mount();
    const pad = await ready();
    server = { content: "Conor's list", updatedAt: "2026-11-09T14:30:00.000Z", updatedByName: "Conor" };
    fireEvent.change(pad, { target: { value: "My list" } });
    await vi.advanceTimersByTimeAsync(1300);
    await screen.findByTestId("notepad-conflict");
    fireEvent.click(screen.getByTestId("button-keep-mine"));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toEqual({ content: "My list", baseUpdatedAt: "2026-11-09T14:30:00.000Z" });
    await waitFor(() => expect(screen.queryByTestId("notepad-conflict")).toBeNull());
  });

  it("lists earlier versions and puts a restored one back on the page, where it autosaves", async () => {
    versions = [{ id: "v1", content: "Last week's list", savedAt: "2026-11-02T10:00:00.000Z", savedByName: "Conor" }];
    mount();
    const pad = await ready();
    fireEvent.click(screen.getByTestId("button-notepad-history"));
    const history = await screen.findByTestId("notepad-history");
    await waitFor(() => expect(history).toHaveTextContent("kept for 90 days"));
    expect(history).toHaveTextContent("Last week's list");
    expect(history).toHaveTextContent("Conor");
    fireEvent.click(screen.getByTestId("button-restore-v1"));
    expect(pad).toHaveValue("Last week's list");
    expect(screen.queryByTestId("notepad-history")).toBeNull();
    await vi.advanceTimersByTimeAsync(1300);
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].content).toBe("Last week's list");
  });

  it("says when the notepad didn't load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "down" }, { status: 500 })));
    mount();
    expect(await screen.findByText("The notepad didn't load.")).toBeInTheDocument();
  });
});
