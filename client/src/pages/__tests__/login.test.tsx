// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import Login from "@/pages/login";
import { apiRequest, queryClient } from "@/lib/queryClient";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/lib/queryClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/queryClient")>();
  return {
    ...original,
    apiRequest: vi.fn(),
    getQueryFn: () => async () => null,
  };
});

function renderLogin(needsSetup = false, providers = { google: true, microsoft: true, apple: true, yahoo: true }, setupCodeRequired = false) {
  queryClient.setQueryData(["/api/auth/setup-status"], { needsSetup, setupCodeRequired });
  queryClient.setQueryData(["/api/auth/providers"], providers);
  return render(<QueryClientProvider client={queryClient}><Login /></QueryClientProvider>);
}

function submitLogin() {
  fireEvent.change(screen.getByTestId("input-login-username"), { target: { value: "rae@finishworks.test" } });
  fireEvent.change(screen.getByTestId("input-login-password"), { target: { value: "real-password" } });
  fireEvent.click(screen.getByTestId("button-sign-in"));
}

describe("JobsOxo login", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });
  afterEach(() => {
    cleanup();
    queryClient.clear();
  });

  it("uses the existing login request and updates the auth cache on success", async () => {
    const user = { id: 17, username: "rae@finishworks.test" };
    vi.mocked(apiRequest).mockResolvedValue(new Response(JSON.stringify(user)));
    renderLogin();
    submitLogin();
    await waitFor(() => expect(queryClient.getQueryData(["/api/auth/me"])).toEqual(user));
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/auth/login", {
      username: "rae@finishworks.test", password: "real-password",
    });
  });

  it("shows an inline server rejection, retains the error toast, and offers local reset", async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error("401: Invalid credentials"));
    renderLogin();
    submitLogin();
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Login failed", variant: "destructive" }));
    fireEvent.click(screen.getByRole("button", { name: "reset your password" }));
    expect(screen.getByTestId("button-send-reset")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("validates before sending and toggles password visibility", async () => {
    renderLogin();
    fireEvent.click(screen.getByTestId("button-sign-in"));
    expect(await screen.findByText("Username is required")).toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByTestId("input-login-password")).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.getByTestId("input-login-password")).toHaveAttribute("type", "password");
  });

  it("navigates locally between login, invite signup, and password reset", () => {
    renderLogin();
    fireEvent.click(screen.getByTestId("link-signup-with-invite"));
    expect(screen.getByTestId("input-signup-invite-code")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("link-back-to-login-from-signup"));
    fireEvent.click(screen.getByTestId("link-forgot-password"));
    expect(screen.getByTestId("input-forgot-username")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("link-back-to-login"));
    expect(screen.getByTestId("button-sign-in")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("preserves all enabled providers and omits unconfigured providers", () => {
    renderLogin(false, { google: false, microsoft: true, apple: false, yahoo: true });
    expect(screen.getByTestId("button-oauth-microsoft")).toHaveAttribute("href", "/api/auth/microsoft");
    expect(screen.getByTestId("button-oauth-yahoo")).toHaveAttribute("href", "/api/auth/yahoo");
    expect(screen.queryByTestId("button-oauth-google")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-oauth-apple")).not.toBeInTheDocument();
  });

  it("keeps first-run setup and its configured providers available", () => {
    renderLogin(true);
    expect(screen.getByTestId("input-setup-username")).toBeInTheDocument();
    expect(screen.getByTestId("button-oauth-setup-apple")).toHaveAttribute("href", "/api/auth/apple");
    fireEvent.click(screen.getByTestId("link-setup-forgot-password"));
    expect(screen.getByTestId("button-send-reset")).toBeInTheDocument();
  });

  it("asks for the setup code when the server requires one and sends it", async () => {
    vi.mocked(apiRequest).mockResolvedValue(new Response(JSON.stringify({ id: "u1", username: "owner", isAdmin: true })));
    renderLogin(true, undefined, true);
    fireEvent.change(screen.getByTestId("input-setup-username"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByTestId("input-setup-password"), { target: { value: "Setup-Code-123" } });
    fireEvent.change(screen.getByTestId("input-setup-confirm"), { target: { value: "Setup-Code-123" } });

    fireEvent.click(screen.getByTestId("button-create-account"));
    expect(await screen.findByText("Setup code is required")).toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("input-setup-code"), { target: { value: "correct-horse" } });
    fireEvent.click(screen.getByTestId("button-create-account"));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/auth/register", {
      username: "owner@example.com", password: "Setup-Code-123", setupCode: "correct-horse",
    }));
  });

  it("hides the setup code field when no code is required", () => {
    renderLogin(true);
    expect(screen.getByTestId("input-setup-username")).toBeInTheDocument();
    expect(screen.queryByTestId("input-setup-code")).not.toBeInTheDocument();
  });

  it("uses the password-reset mutation and renders the sent confirmation", async () => {
    vi.mocked(apiRequest).mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    renderLogin();
    fireEvent.click(screen.getByTestId("link-forgot-password"));
    fireEvent.change(screen.getByTestId("input-forgot-username"), { target: { value: "rae" } });
    fireEvent.click(screen.getByTestId("button-send-reset"));
    expect(await screen.findByTestId("button-back-to-login")).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith("POST", "/api/auth/forgot-password", { username: "rae" });
  });
});
