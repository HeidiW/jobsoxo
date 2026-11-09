import { eq } from "drizzle-orm";
import { db } from "./db";
import { gustoEmployeeMappings, type Employee } from "@shared/schema";
import { allGustoEmployees, companyIntegration } from "./gusto-company";
import { GustoProviderError, gustoRequest } from "./gusto-client";
import { storage } from "./storage";
import { businessDay } from "./business-time";
import { prefillWithholdingAllowance, type PrefillResult } from "./gusto-state-tax";

// Adds a JobsOxo employee to Gusto and invites them to self-onboard: Gusto
// emails them to enter their own SSN, W-4, state tax and bank details, so the
// admin never handles that information. JobsOxo supplies the name, email, work
// location, job title, hire date and pay rate.
//
// Every step checks what Gusto already has, so a retry after a partial failure
// carries on instead of creating a duplicate.

export type InviteOutcome = {
  status: "invited" | "already_invited" | "in_gusto";
  gustoEmployeeId: string;
  onboardingStatus: string;
  /** State withholding allowance pre-filled from the JobsOxo employee, if Gusto asked for it. */
  withholding: PrefillResult["outcome"] | "failed";
};

const INVITABLE = new Set(["self_onboarding_pending_invite", "admin_onboarding_incomplete"]);
const INVITED = new Set(["self_onboarding_invited", "self_onboarding_invited_started", "self_onboarding_invited_overdue"]);

function invalid(message: string): never {
  throw new GustoProviderError(message, 400, "invalid_employee");
}

/** Gusto compensation from JobsOxo pay: day and hourly rates over an 8-hour day. */
export function gustoCompensation(employee: Pick<Employee, "payType" | "dayRate" | "annualSalary">) {
  if (employee.payType === "salary") {
    const yearly = Number(employee.annualSalary) || Number(employee.dayRate) * 260;
    return { rate: yearly.toFixed(2), payment_unit: "Year", flsa_status: "Salaried Nonexempt" };
  }
  return { rate: (Number(employee.dayRate) / 8).toFixed(2), payment_unit: "Hour", flsa_status: "Nonexempt" };
}

function splitName(name: string, override?: { firstName?: string; lastName?: string }) {
  const first = override?.firstName?.trim();
  const last = override?.lastName?.trim();
  if (first && last) return { first_name: first, last_name: last };
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) invalid("Gusto needs a first and last name. Edit the employee's name and try again.");
  return { first_name: parts[0], last_name: parts[parts.length - 1] };
}

export async function inviteEmployeeToGusto(
  userId: string,
  employeeId: string,
  names?: { firstName?: string; lastName?: string },
): Promise<InviteOutcome> {
  const integration = await companyIntegration(userId);
  const employee = await storage.getEmployee(employeeId);
  if (!employee) throw new GustoProviderError("Employee not found.", 404, "not_found");
  if (employee.status !== "active") invalid("Only active employees can be invited to Gusto payroll.");
  if (employee.employmentType === "1099") invalid("Contractors aren't invited to W-2 payroll.");
  const email = employee.email?.trim();
  if (!email) invalid("Add an email address so Gusto can send the invitation.");
  if (!(Number(employee.dayRate) > 0)) invalid("Add a pay rate before inviting to Gusto payroll.");

  const company = `/v1/companies/${integration.companyId}`;
  const call = <T = any>(path: string, options: { method?: string; body?: unknown } = {}) => gustoRequest<T>(path, { userId, ...options });

  // 1. Find this person in Gusto: the existing link, then a match by email, else create them.
  const [mapping] = await db.select().from(gustoEmployeeMappings).where(eq(gustoEmployeeMappings.employeeId, employeeId));
  let gustoEmployee: any = mapping ? await call(`/v1/employees/${mapping.gustoEmployeeId}`) : undefined;
  if (!gustoEmployee) {
    const everyone = await allGustoEmployees(userId, integration.companyId!);
    gustoEmployee = everyone.find((g) => !g.terminated &&
      [g.email, g.work_email].some((e) => typeof e === "string" && e.toLowerCase() === email.toLowerCase()));
  }
  if (!gustoEmployee) {
    gustoEmployee = await call(`${company}/employees`, {
      method: "POST", body: { ...splitName(employee.name, names), email, self_onboarding: true },
    });
  }
  if (!mapping) {
    // Link straight away, so a later failure is retried against this record.
    await db.insert(gustoEmployeeMappings).values({
      employeeId, gustoEmployeeId: gustoEmployee.uuid, companyId: integration.companyId, environment: integration.environment,
      onboardingStatus: String(gustoEmployee.onboarding_status ?? "unknown"),
    });
  }
  const employeePath = `/v1/employees/${gustoEmployee.uuid}`;
  const startDate = employee.hireDate ? employee.hireDate.toISOString().slice(0, 10) : businessDay();

  // 2. Work location and job with pay, if Gusto doesn't have them yet.
  const workAddresses = await call<any[]>(`${employeePath}/work_addresses`);
  if (!Array.isArray(workAddresses) || workAddresses.length === 0) {
    const locations = await call<any[]>(`${company}/locations`);
    const location = Array.isArray(locations) ? locations.find((l) => l.filing_address) ?? locations[0] : undefined;
    if (!location?.uuid) invalid("Add the company address in Gusto before inviting employees.");
    await call(`${employeePath}/work_addresses`, { method: "POST", body: { location_uuid: location.uuid, effective_date: startDate } });
  }
  if (!Array.isArray(gustoEmployee.jobs) || gustoEmployee.jobs.length === 0) {
    const job = await call(`${employeePath}/jobs`, { method: "POST", body: { title: employee.position || "Employee", hire_date: startDate } });
    const compensation = (job?.compensations ?? []).find((c: any) => c.uuid === job?.current_compensation_uuid) ?? job?.compensations?.[0];
    if (compensation?.uuid) {
      await call(`/v1/compensations/${compensation.uuid}`, {
        method: "PUT", body: { version: compensation.version, ...gustoCompensation(employee) },
      });
    }
  }

  // 3. Pre-fill the state withholding allowance the admin entered, if Gusto
  // asks for one and it's still blank. A problem here must not block the invite.
  let withholding: InviteOutcome["withholding"] = "skipped";
  try {
    withholding = (await prefillWithholdingAllowance(call, gustoEmployee.uuid, employee.taxAllowances)).outcome;
  } catch {
    withholding = "failed";
  }

  // 4. Send Gusto's self-onboarding invitation.
  let onboardingStatus = String(gustoEmployee.onboarding_status ?? "self_onboarding_pending_invite");
  let status: InviteOutcome["status"] = "in_gusto";
  if (INVITED.has(onboardingStatus)) {
    status = "already_invited";
  } else if (INVITABLE.has(onboardingStatus)) {
    await call(`${employeePath}/onboarding_status`, { method: "PUT", body: { onboarding_status: "self_onboarding_invited" } });
    onboardingStatus = "self_onboarding_invited";
    status = "invited";
  }
  await db.update(gustoEmployeeMappings)
    .set({ onboardingStatus, lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(gustoEmployeeMappings.employeeId, employeeId));
  return { status, gustoEmployeeId: gustoEmployee.uuid, onboardingStatus, withholding };
}

async function linkedGustoEmployee(userId: string, employeeId: string) {
  const integration = await companyIntegration(userId);
  const [mapping] = await db.select().from(gustoEmployeeMappings).where(eq(gustoEmployeeMappings.employeeId, employeeId));
  if (!mapping) throw new GustoProviderError("This employee isn't linked to Gusto yet. Invite them first.", 409, "not_linked");
  const call = <T = any>(path: string, options: { method?: string; body?: unknown } = {}) => gustoRequest<T>(path, { userId, ...options });
  const gustoEmployee = await call(`/v1/employees/${mapping.gustoEmployeeId}`);
  return { integration, mapping, call, gustoEmployee, path: `/v1/employees/${mapping.gustoEmployeeId}` };
}

async function recordOnboardingStatus(employeeId: string, onboardingStatus: string) {
  await db.update(gustoEmployeeMappings)
    .set({ onboardingStatus, lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(gustoEmployeeMappings.employeeId, employeeId));
}

/**
 * Send Gusto's self-onboarding invitation again. Gusto only moves to
 * "invited" from the un-invited states, so an outstanding invite is cancelled
 * and re-issued, which gives the employee a fresh email.
 */
export async function resendGustoInvitation(userId: string, employeeId: string) {
  const { call, gustoEmployee, path } = await linkedGustoEmployee(userId, employeeId);
  const status = String(gustoEmployee?.onboarding_status ?? "");
  if (status === "onboarding_completed") throw new GustoProviderError("This employee has already finished Gusto onboarding.", 409, "already_onboarded");
  if (INVITED.has(status)) {
    await call(`${path}/onboarding_status`, { method: "PUT", body: { onboarding_status: "admin_onboarding_incomplete" } });
  }
  await call(`${path}/onboarding_status`, { method: "PUT", body: { onboarding_status: "self_onboarding_invited" } });
  await recordOnboardingStatus(employeeId, "self_onboarding_invited");
  return { onboardingStatus: "self_onboarding_invited" };
}

/**
 * Cancel the employee's self-onboarding so the admin can finish their details
 * in Gusto's screens instead of waiting for them.
 */
export async function takeOverGustoOnboarding(userId: string, employeeId: string) {
  const { call, gustoEmployee, path } = await linkedGustoEmployee(userId, employeeId);
  const status = String(gustoEmployee?.onboarding_status ?? "");
  if (status === "onboarding_completed") throw new GustoProviderError("This employee has already finished Gusto onboarding.", 409, "already_onboarded");
  if (status !== "admin_onboarding_incomplete") {
    await call(`${path}/onboarding_status`, { method: "PUT", body: { onboarding_status: "admin_onboarding_incomplete" } });
  }
  await recordOnboardingStatus(employeeId, "admin_onboarding_incomplete");
  return { onboardingStatus: "admin_onboarding_incomplete" };
}

/** Remove a JobsOxo→Gusto link. Nothing in Gusto is changed. */
export async function unlinkGustoEmployee(employeeId: string) {
  const deleted = await db.delete(gustoEmployeeMappings).where(eq(gustoEmployeeMappings.employeeId, employeeId)).returning();
  if (deleted.length === 0) throw new GustoProviderError("This employee isn't linked to Gusto.", 404, "not_linked");
  return { unlinked: true };
}

/**
 * Delete an employee from Gusto and JobsOxo. Gusto only deletes employees who
 * are still onboarding; an onboarded employee must be terminated in Gusto
 * instead, so that case is refused rather than guessed at. JobsOxo refuses if
 * the employee has worksheet or Gusto payroll history.
 */
export async function removeEmployeeEverywhere(userId: string, employeeId: string) {
  const employee = await storage.getEmployee(employeeId);
  if (!employee) throw new GustoProviderError("Employee not found.", 404, "not_found");
  const [mapping] = await db.select().from(gustoEmployeeMappings).where(eq(gustoEmployeeMappings.employeeId, employeeId));
  let removedFromGusto = false;
  if (mapping) {
    const integration = await companyIntegration(userId);
    if (mapping.companyId && mapping.companyId !== integration.companyId) {
      throw new GustoProviderError("This employee is linked to a different Gusto company.", 409, "wrong_company");
    }
    const path = `/v1/employees/${mapping.gustoEmployeeId}`;
    let gustoEmployee: any = null;
    try {
      gustoEmployee = await gustoRequest<any>(path, { userId });
    } catch (error) {
      if (!(error instanceof GustoProviderError && error.status === 404)) throw error;
    }
    if (gustoEmployee) {
      if (gustoEmployee.onboarding_status === "onboarding_completed" || gustoEmployee.onboarded === true) {
        throw new GustoProviderError(
          "Gusto won't delete an employee who has finished onboarding. Terminate them in Gusto (Manage employees), then mark them inactive here.",
          409, "onboarded",
        );
      }
      await gustoRequest(path, { userId, method: "DELETE" });
      removedFromGusto = true;
    }
    await db.delete(gustoEmployeeMappings).where(eq(gustoEmployeeMappings.employeeId, employeeId));
  }
  try {
    await storage.deleteEmployee(employeeId);
  } catch (error: any) {
    // Foreign keys from worksheets / Gusto payroll items block the delete.
    if (error?.code === "23503") {
      throw new GustoProviderError(
        removedFromGusto
          ? "Removed from Gusto, but this employee has payroll history in JobsOxo and can't be deleted. Mark them inactive instead."
          : "This employee has payroll history in JobsOxo and can't be deleted. Mark them inactive instead.",
        409, "has_history",
      );
    }
    throw error;
  }
  return { removedFromGusto, removedFromJobsOxo: true };
}
