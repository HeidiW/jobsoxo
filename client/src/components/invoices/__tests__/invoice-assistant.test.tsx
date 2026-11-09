// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { InvoiceAssistantPanel } from "@/components/invoices/invoice-assistant";
import { queryClient } from "@/lib/queryClient";
import type { InvoiceSnapshot } from "@shared/invoice-assistant";

const snapshot: InvoiceSnapshot = {
  invoiceNumber: null, clientName: "Maple Street Homes", jobName: null, issueDate: "2026-11-08", dueDate: "2026-12-08",
  taxRate: "0", notes: "", termsAndConditions: "", lineItems: [],
};
const proposal = {
  summary: "Add the kitchen repaint as one lump sum.",
  lineItems: [{ section: "Kitchen", category: "labor", description: "Prep walls, two coats eggshell", quantity: 1, unit: "lump", rate: 850 }],
  notes: null, termsAndConditions: null, dueDate: null, taxRate: null,
};

let posts: Array<Record<string, any>>;
let available: boolean;
let reply: Array<Record<string, unknown>>;

function sse(events: Array<Record<string, unknown>>) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function mount(onApply = vi.fn()) {
  render(<QueryClientProvider client={queryClient}><InvoiceAssistantPanel open onClose={() => {}} snapshot={snapshot} onApply={onApply} /></QueryClientProvider>);
  return onApply;
}

describe("InvoiceAssistantPanel", () => {
  beforeEach(() => {
    queryClient.clear();
    posts = [];
    available = true;
    reply = [
      { type: "text", text: "Here's " }, { type: "text", text: "an idea." },
      { type: "proposal", id: "tu_1", input: proposal },
      { type: "done", content: [{ type: "text", text: "Here's an idea." }, { type: "tool_use", id: "tu_1", name: "propose_invoice_changes", input: proposal }], stopReason: "end_turn" },
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/status")) return Response.json({ available });
      posts.push(JSON.parse(String(init?.body)));
      return sse(reply);
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("streams a reply, shows the proposal, and reports what the person did with it next turn", async () => {
    const onApply = mount();
    fireEvent.change(screen.getByTestId("input-assistant-message"), { target: { value: "What should I charge?" } });
    fireEvent.click(screen.getByTestId("button-assistant-send"));

    expect(screen.getByTestId("assistant-turn-user")).toHaveTextContent("What should I charge?");
    await waitFor(() => expect(screen.getByTestId("assistant-turn-assistant")).toHaveTextContent("Here's an idea."));
    expect(posts[0].invoice.clientName).toBe("Maple Street Homes");
    expect(posts[0].messages).toEqual([{ role: "user", content: [{ type: "text", text: "What should I charge?" }] }]);

    const card = screen.getByTestId("assistant-proposal-tu_1");
    expect(card).toHaveTextContent("Prep walls, two coats eggshell");
    expect(card).toHaveTextContent("1 lump × $850.00 = $850.00");
    fireEvent.click(screen.getByTestId("button-apply-tu_1"));
    expect(onApply).toHaveBeenCalledWith(proposal);
    expect(card).toHaveTextContent("Added to the invoice");

    reply = [{ type: "text", text: "Done." }, { type: "done", content: [{ type: "text", text: "Done." }], stopReason: "end_turn" }];
    fireEvent.change(screen.getByTestId("input-assistant-message"), { target: { value: "Thanks" } });
    fireEvent.click(screen.getByTestId("button-assistant-send"));
    await waitFor(() => expect(posts).toHaveLength(2));
    const last = posts[1].messages;
    expect(last).toHaveLength(3);
    expect(last[1].role).toBe("assistant");
    expect(last[2].content[0]).toEqual({ type: "tool_result", tool_use_id: "tu_1", content: "The person applied this proposal to the invoice." });
    expect(last[2].content[1]).toEqual({ type: "text", text: "Thanks" });
  });

  it("offers starter questions and sends one on click", async () => {
    mount();
    fireEvent.click(screen.getAllByTestId("assistant-starter")[0]);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].messages[0].content[0].text).toBe("What's missing from this invoice?");
  });

  it("shows an error and keeps the message when the server fails", async () => {
    reply = [{ type: "error", message: "The assistant is busy right now. Try again in a moment." }];
    mount();
    fireEvent.change(screen.getByTestId("input-assistant-message"), { target: { value: "Hello?" } });
    fireEvent.click(screen.getByTestId("button-assistant-send"));
    await waitFor(() => expect(screen.getByTestId("assistant-error")).toHaveTextContent("busy right now"));
    expect(screen.queryByTestId("assistant-turn-user")).not.toBeInTheDocument();
    expect(screen.getByTestId("input-assistant-message")).toHaveValue("Hello?");
  });

  it("explains when the server has no API key", async () => {
    available = false;
    mount();
    expect(await screen.findByTestId("assistant-unavailable")).toHaveTextContent("connect JobsOxo to Claude");
    expect(screen.queryByTestId("input-assistant-message")).not.toBeInTheDocument();
  });
});
