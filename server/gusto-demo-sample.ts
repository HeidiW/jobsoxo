import { companyIntegration, syncCompany, verifyDemoFunding } from "./gusto-company";
import { GustoProviderError, gustoEnvironment, gustoRequest } from "./gusto-client";
import { businessDay } from "./business-time";

// Fills a Gusto *demo* company with sample data through Gusto's API, using
// Gusto's documented demo test values (EIN 91-0532465, routing 102001017,
// SSN 123-45-1776). Steps Gusto already reports complete are skipped, so it is
// safe to run again after a partial failure.
//
// Deliberately not automated: signing company forms (that is agreeing to
// Gusto's documents, which only the admin may do) and state tax setup (no
// reliable demo values). The result lists them as manual steps.

export type SampleStep = { step: string; status: "done" | "skipped" | "failed" | "manual"; detail?: string };

const ADDRESS = { street_1: "123 Test Street", street_2: "Suite 200", city: "New York", state: "NY", zip: "10001" };
const PHONE = "2125550100";

const SAMPLE_EMPLOYEES = [
  {
    first_name: "Alexander", last_name: "Hamilton", email: "sonofanorphan@example.com", date_of_birth: "1979-06-01", ssn: "123451776",
    home: { street_1: "45 Sample Avenue", street_2: "Apt 3", city: "Brooklyn", state: "NY", zip: "11201" },
    title: "Painter", rate: "35.00",
  },
  {
    first_name: "Maria", last_name: "Lopez", email: "maria.lopez@example.com", date_of_birth: "1988-03-14", ssn: "123451777",
    home: { street_1: "78 Example Road", street_2: null, city: "Queens", state: "NY", zip: "11375" },
    title: "Plasterer", rate: "32.00",
  },
];

const SIGNATORY = {
  first_name: "Pat", last_name: "Example", title: "Owner", phone: "2125550101", birthday: "1980-01-15",
  email: "owner@example.com", ssn: "123451778",
  home_address: { street_1: "123 Test Street", city: "New York", state: "NY", zip: "10001" },
};

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The first Friday at least a week away, and the Sunday ending that pay period. */
export function samplePaySchedule(today = businessDay()): { anchor_pay_date: string; anchor_end_of_pay_period: string } {
  let payDate = addDays(today, 7);
  while (new Date(`${payDate}T00:00:00Z`).getUTCDay() !== 5) payDate = addDays(payDate, 1);
  return { anchor_pay_date: payDate, anchor_end_of_pay_period: addDays(payDate, -5) };
}

function describeFailure(error: unknown): string {
  if (error instanceof GustoProviderError) {
    return `Gusto ${error.status} ${error.code}${error.field ? ` (${error.field})` : ""}`;
  }
  return error instanceof Error ? error.message : "Unexpected error";
}

export async function fillDemoCompany(userId: string) {
  const integration = await companyIntegration(userId);
  if (integration.environment !== "demo" || gustoEnvironment() !== "demo") {
    throw new GustoProviderError("Sample data can only be added to demo companies.", 409, "demo_only");
  }
  const company = `/v1/companies/${integration.companyId}`;
  const call = <T = any>(path: string, options: { method?: string; body?: unknown } = {}) => gustoRequest<T>(path, { userId, ...options });

  const onboarding = await call(`${company}/onboarding_status`);
  const completed = new Set<string>(
    (onboarding?.onboarding_steps ?? []).filter((step: any) => step.completed).map((step: any) => step.id),
  );
  const results: SampleStep[] = [];

  async function run(step: string, stepId: string | null, action: () => Promise<string | void>) {
    if (stepId && completed.has(stepId)) {
      results.push({ step, status: "skipped", detail: "Already complete in Gusto" });
      return;
    }
    try {
      const detail = await action();
      results.push({ step, status: "done", ...(detail ? { detail } : {}) });
    } catch (error) {
      results.push({ step, status: "failed", detail: describeFailure(error) });
    }
  }

  let locationId: string | undefined;
  await run("Company address", "add_addresses", async () => {
    const locations = await call<any[]>(`${company}/locations`);
    if (Array.isArray(locations) && locations.length > 0) {
      locationId = locations[0].uuid;
      return "Address already on file";
    }
    const created = await call(`${company}/locations`, {
      method: "POST", body: { ...ADDRESS, country: "USA", phone_number: PHONE, mailing_address: true, filing_address: true },
    });
    locationId = created?.uuid;
  });

  await run("Federal tax information", "federal_tax_setup", async () => {
    const current = await call(`${company}/federal_tax_details`);
    const details = await call(`${company}`);
    await call(`${company}/federal_tax_details`, {
      method: "PUT",
      body: {
        version: current?.version, legal_name: details?.name, ein: "910532465",
        tax_payer_type: "LLP", filing_form: "941", taxable_as_scorp: false,
      },
    });
  });

  await run("Industry", "select_industry", async () => {
    await call(`${company}/industry_selection`, {
      method: "PUT", body: { naics_code: "238320", title: "Painting and Wall Covering Contractors" },
    });
  });

  await run("Bank account", "add_bank_info", async () => {
    const accounts = await call<any[]>(`${company}/bank_accounts`);
    if (Array.isArray(accounts) && accounts.length > 0) return "Bank account already on file";
    await call(`${company}/bank_accounts`, {
      method: "POST", body: { routing_number: "102001017", account_number: "000123456789", account_type: "Checking" },
    });
  });

  await run("Pay schedule", "payroll_schedule", async () => {
    const schedules = await call<any[]>(`${company}/pay_schedules`);
    if (Array.isArray(schedules) && schedules.length > 0) return "Pay schedule already on file";
    await call(`${company}/pay_schedules`, { method: "POST", body: { frequency: "Every week", ...samplePaySchedule() } });
  });

  await run("Employees", "add_employees", async () => {
    if (!locationId) {
      const locations = await call<any[]>(`${company}/locations`);
      locationId = Array.isArray(locations) ? locations[0]?.uuid : undefined;
    }
    if (!locationId) throw new Error("Add the company address first");
    const existing = await call<any[]>(`${company}/employees`);
    const existingEmails = new Set((Array.isArray(existing) ? existing : []).map((e: any) => String(e.email ?? "").toLowerCase()));
    const hireDate = addDays(businessDay(), -14);
    let added = 0;
    for (const sample of SAMPLE_EMPLOYEES) {
      if (existingEmails.has(sample.email)) continue;
      const employee = await call(`${company}/employees`, {
        method: "POST",
        body: {
          first_name: sample.first_name, last_name: sample.last_name, email: sample.email,
          date_of_birth: sample.date_of_birth, ssn: sample.ssn, self_onboarding: false,
        },
      });
      const employeePath = `/v1/employees/${employee.uuid}`;
      await call(`${employeePath}/home_addresses`, { method: "POST", body: { ...sample.home, effective_date: hireDate } });
      await call(`${employeePath}/work_addresses`, { method: "POST", body: { location_uuid: locationId, effective_date: hireDate } });
      const job = await call(`${employeePath}/jobs`, { method: "POST", body: { title: sample.title, hire_date: hireDate } });
      const compensation = (job?.compensations ?? []).find((c: any) => c.uuid === job?.current_compensation_uuid) ?? job?.compensations?.[0];
      if (compensation?.uuid) {
        await call(`/v1/compensations/${compensation.uuid}`, {
          method: "PUT", body: { version: compensation.version, rate: sample.rate, payment_unit: "Hour", flsa_status: "Nonexempt" },
        });
      }
      const paymentMethod = await call(`${employeePath}/payment_method`);
      await call(`${employeePath}/payment_method`, { method: "PUT", body: { version: paymentMethod?.version, type: "Check" } });
      added += 1;
    }
    return added === 0 ? "Sample employees already on file" : `Added ${added} employee${added === 1 ? "" : "s"}`;
  });

  await run("Signatory", null, async () => {
    const signatories = await call<any[]>(`${company}/signatories`);
    if (Array.isArray(signatories) && signatories.length > 0) return "Signatory already on file";
    await call(`${company}/signatories`, { method: "POST", body: SIGNATORY });
  });

  await run("Verify bank account", "verify_bank_info", async () => {
    const status = await verifyDemoFunding(userId);
    if (status.fundingAccount?.status !== "verified") throw new Error("Bank account is not verified yet");
  });

  if (!completed.has("state_setup")) {
    results.push({ step: "State tax information", status: "manual", detail: "Fill in with Complete company setup" });
  }
  if (!completed.has("sign_all_forms")) {
    results.push({ step: "Sign documents", status: "manual", detail: "Review and sign with Complete company setup" });
  }

  return { results, status: await syncCompany(userId) };
}
