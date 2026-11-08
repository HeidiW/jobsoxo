// What the Payroll page should lead with, from Gusto status and employee
// readiness. Pure functions so the header logic is testable without rendering.

export type GustoStatusLite = {
  companyId?: string;
  onboardingComplete?: boolean;
  fundingAccount?: { status: string } | null;
} | undefined;

export type ReadinessLite = { employees?: Array<{ ready: boolean; gustoEmployeeId?: string | null }> } | undefined;

export type NextStep = {
  key: "log_hours" | "checking" | "connect_gusto" | "finish_setup" | "add_employees" | "finish_employees" | "prepare_run";
  label: string;
  /** What the button does: open a dialog, or scroll to the Gusto workspace. */
  target: "time_dialog" | "workspace" | "employee_dialog" | "run_dialog" | "none";
};

export type StatusItem = {
  key: "gusto" | "employees" | "period";
  label: string;
  value: string;
  state: "done" | "todo" | "unknown" | "info";
};

type Input = {
  isAdmin: boolean;
  statusLoaded: boolean;
  status: GustoStatusLite;
  readinessLoaded: boolean;
  readiness: ReadinessLite;
};

export function gustoSetupComplete(status: GustoStatusLite): boolean {
  return !!status?.companyId && status.onboardingComplete === true && status.fundingAccount?.status === "verified";
}

/** The single primary action for the page header. Members only log hours. */
export function payrollNextStep({ isAdmin, statusLoaded, status, readinessLoaded, readiness }: Input): NextStep {
  if (!isAdmin) return { key: "log_hours", label: "Log hours", target: "time_dialog" };
  if (!statusLoaded) return { key: "checking", label: "Checking Gusto…", target: "none" };
  if (!status?.companyId) return { key: "connect_gusto", label: "Set up Gusto payroll", target: "workspace" };
  if (!gustoSetupComplete(status)) return { key: "finish_setup", label: "Finish Gusto setup", target: "workspace" };
  if (!readinessLoaded) return { key: "checking", label: "Checking employees…", target: "none" };
  const employees = readiness?.employees ?? [];
  if (employees.length === 0) return { key: "add_employees", label: "Add employees", target: "employee_dialog" };
  if (employees.some((e) => !e.ready)) return { key: "finish_employees", label: "Finish employee setup", target: "workspace" };
  return { key: "prepare_run", label: "Prepare pay run", target: "run_dialog" };
}

/** The status strip: Gusto, employees ready, and the pay period being viewed. */
export function payrollStatusItems(input: Input & { periodLabel: string | null }): StatusItem[] {
  const { isAdmin, statusLoaded, status, readinessLoaded, readiness, periodLabel } = input;
  const items: StatusItem[] = [];
  if (isAdmin) {
    items.push(!statusLoaded
      ? { key: "gusto", label: "Gusto payroll", value: "Checking…", state: "unknown" }
      : !status?.companyId
        ? { key: "gusto", label: "Gusto payroll", value: "Not connected", state: "todo" }
        : gustoSetupComplete(status)
          ? { key: "gusto", label: "Gusto payroll", value: "Connected and set up", state: "done" }
          : { key: "gusto", label: "Gusto payroll", value: "Setup incomplete", state: "todo" });
    const employees = readiness?.employees ?? [];
    const ready = employees.filter((e) => e.ready).length;
    items.push(!readinessLoaded
      ? { key: "employees", label: "Employees ready", value: "Checking…", state: "unknown" }
      : employees.length === 0
        ? { key: "employees", label: "Employees ready", value: "None added", state: "todo" }
        : { key: "employees", label: "Employees ready", value: `${ready} of ${employees.length}`, state: ready === employees.length ? "done" : "todo" });
  }
  items.push({ key: "period", label: "Pay period", value: periodLabel ?? "No pay run prepared", state: "info" });
  return items;
}
