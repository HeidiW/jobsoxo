// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import GustoProductionPanel, { type ProductionReadiness } from "@/components/payroll/gusto-production-panel";
import { queryClient } from "@/lib/queryClient";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

let readiness: ProductionReadiness;
let posts: Array<Record<string, unknown>>;
let createStatus: number;

function mount() {
  return render(<QueryClientProvider client={queryClient}><GustoProductionPanel panel={{}} buttonStyle={{}} busy={false} /></QueryClientProvider>);
}

describe("GustoProductionPanel", () => {
  beforeEach(() => {
    queryClient.clear(); toast.mockReset(); posts = []; createStatus = 201;
    readiness = {
      environment: "production",
      gates: { productionEnvironment: true, applicationCredentials: true, companyCreationEnabled: true, webhookSecret: false, livePayrollEnabled: false },
      company: { attached: false, companyId: null, state: null, environment: null, creationPending: false },
      employees: { active: 0, linked: 0 },
      nextStep: "Create the real company below with its legal name and the signatory's details.",
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return Response.json(createStatus === 201 ? { companyId: "c1", environment: "production", state: "connected" } : { error: "Gusto rejected the production credentials or the app isn't approved for production yet." }, { status: createStatus }); }
      return Response.json(readiness);
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("lists the gates with their state and the next step", async () => {
    mount();
    expect(await screen.findByTestId("gusto-production-next")).toHaveTextContent("Next: Create the real company below");
    expect(screen.getByTestId("gate-productionEnvironment")).toHaveAttribute("data-state", "on");
    expect(screen.getByTestId("gate-webhookSecret")).toHaveAttribute("data-state", "off");
    expect(screen.getByTestId("gate-livePayrollEnabled")).toHaveTextContent("off");
    expect(screen.getByTestId("gate-company")).toHaveAttribute("data-state", "off");
  });

  it("offers the creation form only when every gate before it is open, and requires the legal name twice", async () => {
    mount();
    const form = await screen.findByTestId("gusto-production-create");
    expect(form).toBeInTheDocument();
    const button = screen.getByTestId("button-create-live-company") as HTMLButtonElement;
    fireEvent.change(screen.getByTestId("input-live-legal-name"), { target: { value: "Conor Foy Painting LLC" } });
    fireEvent.change(screen.getByTestId("input-live-legal-name-confirm"), { target: { value: "Conor Foy Painting" } });
    expect(screen.getByRole("alert")).toHaveTextContent("don’t match");
    fireEvent.change(screen.getByTestId("input-live-legal-name-confirm"), { target: { value: "Conor Foy Painting LLC" } });
    fireEvent.change(screen.getByTestId("input-live-first-name"), { target: { value: "Conor" } });
    fireEvent.change(screen.getByTestId("input-live-last-name"), { target: { value: "Foy" } });
    fireEvent.change(screen.getByTestId("input-live-email"), { target: { value: "conor@example.test" } });
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("checkbox-live-confirm"));
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ legalName: "Conor Foy Painting LLC", confirmLegalName: "Conor Foy Painting LLC", firstName: "Conor", lastName: "Foy", email: "conor@example.test", confirmProduction: true });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Company created in Gusto" })));
  });

  it("hides the form when creation is switched off or a company is attached, and shows Gusto's refusal", async () => {
    readiness = { ...readiness, gates: { ...readiness.gates, companyCreationEnabled: false }, nextStep: "Set GUSTO_LIVE_COMPANY_CREATION_ENABLED=true in Render to unlock creating the real company, then create it below." };
    mount();
    await screen.findByTestId("gusto-production-next");
    expect(screen.queryByTestId("gusto-production-create")).toBeNull();
    cleanup(); queryClient.clear();

    readiness = { ...readiness, gates: { ...readiness.gates, companyCreationEnabled: true }, company: { attached: true, companyId: "c1", state: "connected", environment: "production", creationPending: false }, employees: { active: 3, linked: 2 } };
    mount();
    expect(await screen.findByTestId("gate-company")).toHaveTextContent("2 of 3 active employees linked");
    expect(screen.queryByTestId("gusto-production-create")).toBeNull();
    cleanup(); queryClient.clear();

    readiness = { ...readiness, company: { attached: false, companyId: null, state: null, environment: null, creationPending: false } };
    createStatus = 502;
    mount();
    await screen.findByTestId("gusto-production-create");
    fireEvent.change(screen.getByTestId("input-live-legal-name"), { target: { value: "Conor Foy Painting LLC" } });
    fireEvent.change(screen.getByTestId("input-live-legal-name-confirm"), { target: { value: "Conor Foy Painting LLC" } });
    fireEvent.change(screen.getByTestId("input-live-first-name"), { target: { value: "Conor" } });
    fireEvent.change(screen.getByTestId("input-live-last-name"), { target: { value: "Foy" } });
    fireEvent.change(screen.getByTestId("input-live-email"), { target: { value: "conor@example.test" } });
    fireEvent.click(screen.getByTestId("checkbox-live-confirm"));
    fireEvent.click(screen.getByTestId("button-create-live-company"));
    expect(await screen.findByTestId("gusto-production-error")).toHaveTextContent("isn't approved for production yet");
  });
});
