import { db } from "./db";
import { gustoEmployeeMappings } from "@shared/schema";
import { allGustoEmployees, companyIntegration, syncCompany, syncEmployees } from "./gusto-company";
import { gustoRequest } from "./gusto-client";
import { storage } from "./storage";

// Creates a JobsOxo employee for every current Gusto employee that isn't in
// JobsOxo yet, so companies already on Gusto don't re-enter their crew. Gusto
// stays the source of truth for tax and bank details; JobsOxo only takes the
// name, contact details, job title, hire date and a day rate for estimates.

type PayFields = { dayRate: string; payType: "hourly" | "salary"; annualSalary?: string };

/**
 * Converts a Gusto job's pay into JobsOxo's day rate (8-hour day, 260 working
 * days a year). Null when Gusto didn't share the rate or uses an unknown unit.
 */
export function payFromGustoJob(job: any): PayFields | null {
  const rate = Number(job?.rate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const day = (value: number) => value.toFixed(2);
  switch (job?.payment_unit) {
    case "Hour": return { dayRate: day(rate * 8), payType: "hourly" };
    case "Week": return { dayRate: day(rate / 5), payType: "salary" };
    case "Month": return { dayRate: day((rate * 12) / 260), payType: "salary" };
    case "Year": return { dayRate: day(rate / 260), payType: "salary", annualSalary: day(rate) };
    default: return null;
  }
}

function primaryJob(employee: any) {
  const jobs = Array.isArray(employee?.jobs) ? employee.jobs : [];
  return jobs.find((job: any) => job.primary) ?? jobs[0];
}

export async function importGustoEmployees(userId: string) {
  const integration = await companyIntegration(userId);
  const [gustoEmployees, locations, local, mappings] = await Promise.all([
    allGustoEmployees(userId, integration.companyId!),
    gustoRequest<any[]>(`/v1/companies/${integration.companyId}/locations`, { userId }),
    storage.getEmployees(),
    db.select().from(gustoEmployeeMappings),
  ]);
  const companyState = Array.isArray(locations) ? locations.find((l: any) => l.filing_address)?.state ?? locations[0]?.state : undefined;
  const linkedGustoIds = new Set(mappings.map((m) => m.gustoEmployeeId));
  const localEmails = new Set(local.map((e) => e.email?.toLowerCase()).filter(Boolean));

  const imported: string[] = [];
  const needsRate: string[] = [];
  let alreadyInJobsOxo = 0;

  for (const person of gustoEmployees) {
    if (!person?.uuid || person.terminated === true) continue;
    const email = (person.email || person.work_email || "").trim();
    if (linkedGustoIds.has(person.uuid) || (email && localEmails.has(email.toLowerCase()))) {
      alreadyInJobsOxo += 1;
      continue;
    }
    const name = [person.preferred_first_name || person.first_name, person.last_name].filter(Boolean).join(" ").trim() || "Gusto employee";
    const job = primaryJob(person);
    const pay = payFromGustoJob(job);
    const created = await storage.createEmployee({
      name, email: email || null, phone: person.phone || null, position: job?.title || null,
      hireDate: job?.hire_date ? new Date(`${job.hire_date}T00:00:00Z`) : null,
      dayRate: pay?.dayRate ?? "0", payType: pay?.payType ?? "hourly", annualSalary: pay?.annualSalary ?? null,
      employmentType: "w2", status: "active", ...(companyState ? { stateCode: companyState } : {}),
    });
    // Link by Gusto's ID so people without an email still connect; the sync
    // below then fills in onboarding and payment readiness.
    await db.insert(gustoEmployeeMappings).values({
      employeeId: created.id, gustoEmployeeId: person.uuid,
      companyId: integration.companyId, environment: integration.environment,
    });
    imported.push(name);
    if (!pay) needsRate.push(name);
  }

  const synced = await syncEmployees(userId);
  return { imported, needsRate, alreadyInJobsOxo, linked: synced.length };
}

/** "Sync readiness": refresh company status and pull in anyone new in Gusto. */
export async function syncCompanyAndImport(userId: string) {
  const status = await syncCompany(userId);
  const imported = await importGustoEmployees(userId);
  return { ...status, imported };
}
