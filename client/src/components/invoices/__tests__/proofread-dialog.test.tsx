// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ProofreadDialog, issueKey } from "@/components/invoices/proofread-dialog";
import type { ProofreadIssue } from "@shared/invoice-proofread";

const fields = [
  { id: "item:1", label: "Line item", text: "Prep and paint kichen walls" },
  { id: "notes", label: "Notes", text: "thanks for your business" },
];
const issues: ProofreadIssue[] = [
  { fieldId: "item:1", kind: "spelling", original: "kichen", replacement: "kitchen", note: "Misspelled" },
  { fieldId: "notes", kind: "capitalization", original: "thanks", replacement: "Thanks", note: "Starts a sentence" },
];

function mount(decisions: Record<string, "fixed" | "kept"> = {}) {
  const handlers = { onFix: vi.fn(), onKeep: vi.fn(), onFixAll: vi.fn(), onContinue: vi.fn(), onCancel: vi.fn() };
  render(<ProofreadDialog open fields={fields} issues={issues} decisions={decisions} continueLabel="Send invoice" {...handlers} />);
  return handlers;
}

describe("ProofreadDialog", () => {
  afterEach(cleanup);

  it("lists each issue with its field, fix and reason, and blocks continuing until all are resolved", () => {
    const handlers = mount();
    expect(screen.getByTestId("dialog-proofread")).toHaveTextContent("2 things to look at");
    const item = screen.getByTestId("proofread-issue-item:1");
    expect(item).toHaveTextContent("Line item");
    expect(item).toHaveTextContent("Spelling");
    expect(item).toHaveTextContent("kichen → kitchen");
    expect(item).toHaveTextContent("Misspelled");
    expect(screen.getByTestId("button-proofread-continue")).toBeDisabled();

    fireEvent.click(screen.getByTestId("button-fix-item:1"));
    expect(handlers.onFix).toHaveBeenCalledWith(issues[0]);
    fireEvent.click(screen.getByTestId("button-keep-notes"));
    expect(handlers.onKeep).toHaveBeenCalledWith(issues[1]);
    fireEvent.click(screen.getByTestId("button-proofread-fix-all"));
    expect(handlers.onFixAll).toHaveBeenCalled();
  });

  it("lets the person continue once every issue is fixed or kept", () => {
    const handlers = mount({ [issueKey(issues[0])]: "fixed", [issueKey(issues[1])]: "kept" });
    expect(screen.getByTestId("proofread-decision-item:1")).toHaveTextContent("Fixed");
    expect(screen.getByTestId("proofread-decision-notes")).toHaveTextContent("Kept as written");
    expect(screen.getByTestId("dialog-proofread")).toHaveTextContent("ready");
    expect(screen.queryByTestId("button-proofread-fix-all")).not.toBeInTheDocument();
    const go = screen.getByTestId("button-proofread-continue");
    expect(go).toBeEnabled();
    expect(go).toHaveTextContent("Send invoice");
    fireEvent.click(go);
    expect(handlers.onContinue).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("button-proofread-cancel"));
    expect(handlers.onCancel).toHaveBeenCalled();
  });
});
