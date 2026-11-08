import { describe, expect, it } from "vitest";
import { payrollNextStep, payrollStatusItems } from "../payroll-next-step";

const ready = { companyId: "c1", onboardingComplete: true, fundingAccount: { status: "verified" } };
const loaded = { isAdmin: true, statusLoaded: true, readinessLoaded: true };

describe("payrollNextStep", () => {
  it("walks an admin through setup in order", () => {
    expect(payrollNextStep({ ...loaded, statusLoaded: false, status: undefined, readiness: undefined }))
      .toMatchObject({ key: "checking", target: "none" });
    expect(payrollNextStep({ ...loaded, status: { configured: false } as any, readiness: undefined }))
      .toMatchObject({ key: "connect_gusto", label: "Set up Gusto payroll", target: "workspace" });
    expect(payrollNextStep({ ...loaded, status: { companyId: "c1", onboardingComplete: false, fundingAccount: null }, readiness: undefined }))
      .toMatchObject({ key: "finish_setup", label: "Finish Gusto setup", target: "workspace" });
    expect(payrollNextStep({ ...loaded, status: { ...ready, fundingAccount: { status: "awaiting_deposits" } }, readiness: undefined }))
      .toMatchObject({ key: "finish_setup" });
    expect(payrollNextStep({ ...loaded, status: ready, readiness: { employees: [] } }))
      .toMatchObject({ key: "add_employees", label: "Add employees", target: "employee_dialog" });
    expect(payrollNextStep({ ...loaded, status: ready, readiness: { employees: [{ ready: true }, { ready: false }] } }))
      .toMatchObject({ key: "finish_employees", label: "Finish employee setup", target: "workspace" });
    expect(payrollNextStep({ ...loaded, status: ready, readiness: { employees: [{ ready: true }] } }))
      .toMatchObject({ key: "prepare_run", label: "Prepare pay run", target: "run_dialog" });
  });

  it("only offers members Log hours", () => {
    expect(payrollNextStep({ isAdmin: false, statusLoaded: false, status: undefined, readinessLoaded: false, readiness: undefined }))
      .toEqual({ key: "log_hours", label: "Log hours", target: "time_dialog" });
  });
});

describe("payrollStatusItems", () => {
  it("shows Gusto, employee readiness and the pay period for admins", () => {
    const items = payrollStatusItems({ ...loaded, status: ready, readiness: { employees: [{ ready: true }, { ready: false }] }, periodLabel: "Nov 10 – Nov 16, 2026" });
    expect(items).toEqual([
      { key: "gusto", label: "Gusto payroll", value: "Connected and set up", state: "done" },
      { key: "employees", label: "Employees ready", value: "1 of 2", state: "todo" },
      { key: "period", label: "Pay period", value: "Nov 10 – Nov 16, 2026", state: "info" },
    ]);
  });

  it("flags an unfinished Gusto setup and a missing pay run", () => {
    const items = payrollStatusItems({ ...loaded, status: { companyId: "c1", onboardingComplete: false, fundingAccount: null }, readiness: { employees: [] }, periodLabel: null });
    expect(items[0]).toMatchObject({ value: "Setup incomplete", state: "todo" });
    expect(items[1]).toMatchObject({ value: "None added", state: "todo" });
    expect(items[2]).toMatchObject({ value: "No pay run prepared", state: "info" });
  });

  it("shows members only the pay period", () => {
    const items = payrollStatusItems({ isAdmin: false, statusLoaded: false, status: undefined, readinessLoaded: false, readiness: undefined, periodLabel: null });
    expect(items.map((i) => i.key)).toEqual(["period"]);
  });
});
