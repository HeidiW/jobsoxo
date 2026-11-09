// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { GetOnItNotepad } from "@/components/notepad/get-on-it-notepad";
import { queryClient } from "@/lib/queryClient";

let server: { content: string; updatedAt: string | null; updatedByName: string | null };
let puts: Array<{ content: string; baseUpdatedAt: string | null }>;

function mount() {
  return render(<QueryClientProvider client={queryClient}><GetOnItNotepad /></QueryClientProvider>);
}

describe("GetOnItNotepad", () => {
  beforeEach(() => {
    queryClient.clear();
    puts = [];
    server = { content: "Order primer", updatedAt: "2026-11-09T14:00:00.000Z", updatedByName: "Heidi" };
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        if (body.baseUpdatedAt !== server.updatedAt) {
          return Response.json({ error: "Conor saved the notepad while you were editing.", current: server }, { status: 409 });
        }
        server = { content: body.content, updatedAt: "2026-11-09T15:00:00.000Z", updatedByName: "Heidi" };
        return Response.json(server);
      }
      return Response.json(server);
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows the saved notes and who saved them, and saves only when changed", async () => {
    mount();
    const pad = await screen.findByTestId("input-notepad");
    await waitFor(() => expect(pad).toHaveValue("Order primer"));
    expect(screen.getByTestId("notepad-status")).toHaveTextContent("by Heidi");
    expect(screen.getByTestId("button-save-notepad")).toBeDisabled();

    fireEvent.change(pad, { target: { value: "Order primer\nCall the supplier" } });
    expect(screen.getByTestId("notepad-status")).toHaveTextContent("Unsaved changes");
    fireEvent.click(screen.getByTestId("button-save-notepad"));
    await waitFor(() => expect(screen.getByTestId("notepad-status")).toHaveTextContent("Saved"));
    expect(puts).toEqual([{ content: "Order primer\nCall the supplier", baseUpdatedAt: "2026-11-09T14:00:00.000Z" }]);
    expect(screen.getByTestId("button-save-notepad")).toBeDisabled();
  });

  it("saves with Cmd/Ctrl+S", async () => {
    mount();
    const pad = await screen.findByTestId("input-notepad");
    await waitFor(() => expect(pad).toHaveValue("Order primer"));
    fireEvent.change(pad, { target: { value: "New note" } });
    fireEvent.keyDown(pad, { key: "s", metaKey: true });
    await waitFor(() => expect(puts).toHaveLength(1));
  });

  it("asks which version to keep when someone else saved first", async () => {
    mount();
    const pad = await screen.findByTestId("input-notepad");
    await waitFor(() => expect(pad).toHaveValue("Order primer"));
    server = { content: "Conor's notes", updatedAt: "2026-11-09T14:30:00.000Z", updatedByName: "Conor" };
    fireEvent.change(pad, { target: { value: "My notes" } });
    fireEvent.click(screen.getByTestId("button-save-notepad"));
    expect(await screen.findByTestId("notepad-conflict")).toHaveTextContent("Conor saved the notepad while you were editing.");
    expect(pad).toHaveValue("My notes");

    fireEvent.click(screen.getByTestId("button-keep-mine"));
    await waitFor(() => expect(screen.queryByTestId("notepad-conflict")).not.toBeInTheDocument());
    expect(puts[1]).toEqual({ content: "My notes", baseUpdatedAt: "2026-11-09T14:30:00.000Z" });
  });

  it("can load the other person's version instead", async () => {
    mount();
    const pad = await screen.findByTestId("input-notepad");
    await waitFor(() => expect(pad).toHaveValue("Order primer"));
    server = { content: "Conor's notes", updatedAt: "2026-11-09T14:30:00.000Z", updatedByName: "Conor" };
    fireEvent.change(pad, { target: { value: "My notes" } });
    fireEvent.click(screen.getByTestId("button-save-notepad"));
    fireEvent.click(await screen.findByTestId("button-load-theirs"));
    expect(pad).toHaveValue("Conor's notes");
    expect(screen.getByTestId("button-save-notepad")).toBeDisabled();
  });
});
