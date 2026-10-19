// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { Link, Router } from "wouter";
import InboxShell from "@/components/inbox-shell";

vi.mock("@/pages/inbox-tasks", () => ({
  default: ({ embedded }: { embedded?: boolean }) => <div data-testid="business-panel">{embedded ? "embedded business" : "full business"}</div>,
}));
vi.mock("@/pages/gmail-todos", () => ({
  default: ({ embedded }: { embedded?: boolean }) => <div data-testid="gmail-panel">{embedded ? "embedded gmail" : "full gmail"}</div>,
}));

describe("InboxShell", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it("loads a query-selected tab, preserves other query values, and only mounts that panel", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/inbox?view=gmail&gmail_connected=1&state=callback");
    render(<Router><InboxShell /></Router>);

    expect(screen.getByTestId("gmail-panel")).toHaveTextContent("embedded gmail");
    expect(screen.queryByTestId("business-panel")).not.toBeInTheDocument();
    const gmailTab = screen.getByRole("tab", { name: /Gmail/ });
    expect(gmailTab).toHaveAttribute("data-state", "active");
    const activePanel = document.getElementById(gmailTab.getAttribute("aria-controls") ?? "");
    expect(activePanel).toHaveAttribute("role", "tabpanel");
    expect(activePanel).toHaveAttribute("aria-labelledby", gmailTab.id);
    expect(screen.getByTestId("inbox-header")).not.toContainElement(activePanel);

    await user.click(screen.getByRole("tab", { name: /Business tasks/ }));
    expect(screen.getByTestId("business-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("gmail-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Business tasks/ })).toHaveAttribute("data-state", "active");
    expect(window.location.search).toContain("gmail_connected=1");
    expect(window.location.search).toContain("state=callback");
    expect(window.location.search).toContain("view=business");
  });

  it("reacts to same-path sidebar navigation, replaceState, and browser back", async () => {
    window.history.replaceState({}, "", "/inbox?view=gmail");
    render(
      <Router>
        <>
          <Link href="/inbox" data-testid="sidebar-inbox-link">Inbox navigation</Link>
          <InboxShell />
        </>
      </Router>,
    );
    expect(screen.getByTestId("gmail-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("sidebar-inbox-link"));
    expect(window.location.pathname).toBe("/inbox");
    expect(window.location.search).toBe("");
    expect(await screen.findByTestId("business-panel")).toBeInTheDocument();

    act(() => window.history.replaceState({}, "", "/inbox?view=gmail&source=replace"));
    expect(await screen.findByTestId("gmail-panel")).toBeInTheDocument();
    act(() => window.history.replaceState({}, "", "/inbox?view=business&source=back-target"));
    expect(await screen.findByTestId("business-panel")).toBeInTheDocument();

    act(() => window.history.pushState({}, "", "/inbox?view=gmail&source=push"));
    expect(await screen.findByTestId("gmail-panel")).toBeInTheDocument();
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByTestId("business-panel")).toBeInTheDocument());
  });
});
