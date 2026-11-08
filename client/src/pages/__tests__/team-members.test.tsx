// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { TeamMembers } from "@/pages/settings";
import { apiRequest, queryClient } from "@/lib/queryClient";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "owner", isAdmin: true } }) }));
vi.mock("@/lib/queryClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/queryClient")>();
  return { ...original, apiRequest: vi.fn(), getQueryFn: () => async () => null };
});

const members = [
  { id: "owner", username: "heidi@jobsoxo.com", displayName: null, email: "heidi@jobsoxo.com", isAdmin: true },
  { id: "co-admin", username: "ops@jobsoxo.com", displayName: "Ops", email: null, isAdmin: true },
  { id: "member", username: "foyconor@gmail.com", displayName: null, email: "foyconor@gmail.com", isAdmin: false },
];

function renderMembers() {
  queryClient.setQueryData(["/api/users"], members);
  return render(<QueryClientProvider client={queryClient}><TeamMembers /></QueryClientProvider>);
}

describe("TeamMembers", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it("shows admins and offers the right action for each person", () => {
    renderMembers();
    expect(screen.getByTestId("badge-admin-owner")).toBeInTheDocument();
    expect(screen.getByText("(you)")).toBeInTheDocument();
    // You can't remove your own admin access from here.
    expect(screen.queryByTestId("button-remove-admin-owner")).not.toBeInTheDocument();
    expect(screen.getByTestId("button-remove-admin-co-admin")).toBeInTheDocument();
    expect(screen.getByTestId("button-make-admin-member")).toBeInTheDocument();
    expect(screen.queryByTestId("badge-admin-member")).not.toBeInTheDocument();
  });

  it("makes a member an admin", async () => {
    vi.mocked(apiRequest).mockResolvedValue(new Response(JSON.stringify({ id: "member", isAdmin: true })));
    renderMembers();

    fireEvent.click(screen.getByTestId("button-make-admin-member"));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("PATCH", "/api/users/member/admin", { isAdmin: true }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "Admin access granted" }));
  });

  it("shows the server's reason when a change is refused", async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error("409: There must be at least one admin. Make someone else an admin first."));
    renderMembers();

    fireEvent.click(screen.getByTestId("button-remove-admin-co-admin"));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Couldn't change admin access",
      description: "There must be at least one admin. Make someone else an admin first.",
    })));
  });
});
