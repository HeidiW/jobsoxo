import { and, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { employees, gustoEmployeeMappings, gustoIntegrations } from "@shared/schema";
import { bootstrapGustoCredentials, gustoConfigured, gustoEnvironment, GustoConfigurationError, GustoProviderError, gustoRequest } from "./gusto-client";

/**
 * The app represents one business, so every administrator acts through the
 * same Gusto connection. Returns the id of the admin whose row holds the
 * connection for the current environment (or a pending demo creation); an
 * admin with no connection yet acts as themselves, e.g. to connect one.
 */
export async function gustoActor(userId: string): Promise<string> {
  const rows = await db.select({ userId: gustoIntegrations.userId, companyId: gustoIntegrations.companyId, environment: gustoIntegrations.environment, state: gustoIntegrations.state }).from(gustoIntegrations);
  const environment = gustoEnvironment();
  const connected = rows.filter(row => row.companyId && row.environment === environment);
  if (connected.length === 1) return connected[0].userId;
  if (connected.some(row => row.userId === userId)) return userId;
  const pending = rows.find(row => ["demo_creating", "demo_creation_unknown"].includes(row.state));
  return pending?.userId ?? userId;
}

export async function companyIntegration(userId: string) {
  const integration = await db.query.gustoIntegrations.findFirst({ where: eq(gustoIntegrations.userId, userId) });
  if (!integration?.companyId || !integration.encryptedAccessToken || integration.environment !== gustoEnvironment()) {
    throw new GustoConfigurationError("Connect your Gusto Embedded company before running payroll.");
  }
  return integration;
}

export async function connectCompany(userId: string) {
  if (!gustoConfigured()) throw new GustoConfigurationError("Gusto Embedded company credentials are not configured.");
  const info = await gustoRequest<any>("/v1/token_info");
  if (info?.resource?.type !== "Company" || info.resource.uuid !== process.env.GUSTO_COMPANY_ID) {
    throw new GustoConfigurationError("The Gusto credential is not authorized for the configured company.");
  }
  const required = ["payrolls:read", "payrolls:write", "payrolls:run", "flows:write", "companies:read",
    "company_onboarding_status:read", "company_bank_accounts:read", "employees:read", "employee_payment_methods:read"];
  const scopes = new Set(String(info.scope ?? "").split(" "));
  const missing = required.filter(scope => !scopes.has(scope));
  if (missing.length) throw new GustoConfigurationError(`Gusto Embedded authorization is missing required scopes: ${missing.join(", ")}.`);
  const companyId = String(info.resource.uuid);
  await db.transaction(async tx => {
    // There is one business in this app. Prevent a global bootstrap secret
    // silently attaching its company to a different admin's ownership boundary.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('gusto-company-connect'))`);
    const all = await tx.select().from(gustoIntegrations);
    if (all.some(row => row.userId !== userId && row.companyId === companyId && row.environment === gustoEnvironment())) {
      throw new GustoConfigurationError("This Gusto company is already connected to another administrator.");
    }
    const previous = all.find(row => row.userId === userId);
    if (all.some(row => ["demo_creating", "demo_creation_unknown"].includes(row.state))) {
      throw new GustoConfigurationError("Resolve the pending demo company creation before connecting company credentials.");
    }
    if (previous?.companyId && (previous.companyId !== companyId || previous.environment !== gustoEnvironment())) {
      throw new GustoConfigurationError("A different Gusto company or environment is already connected. Existing payroll history must not be reassigned.");
    }
    await tx.insert(gustoIntegrations).values({
      userId, companyId, environment: gustoEnvironment(), state: "connected",
      encryptedAccessToken: bootstrapGustoCredentials(),
    }).onConflictDoUpdate({ target: gustoIntegrations.userId, set: {
      // This explicit Connect action can replace expired authorization after
      // updating the secure bootstrap credentials.
      encryptedAccessToken: bootstrapGustoCredentials(), state: "connected", lastError: null, updatedAt: new Date(),
    } });
  });
  return syncCompany(userId);
}

export async function allGustoEmployees(userId: string, companyId: string): Promise<any[]> {
  const result: any[] = [];
  for (let page = 1; page <= 100; page++) {
    const rows = await gustoRequest<any[]>(`/v1/companies/${companyId}/employees?page=${page}&per=100`, { userId });
    if (!Array.isArray(rows)) throw new GustoProviderError("Gusto returned an invalid employee list.", 502, "invalid_response");
    result.push(...rows);
    if (rows.length < 100) return result;
  }
  throw new GustoProviderError("Gusto employee list exceeds the supported size.", 502, "pagination_limit");
}

export async function syncCompany(userId: string) {
  const integration = await companyIntegration(userId);
  const path = `/v1/companies/${integration.companyId}`;
  const [company, onboarding, accounts] = await Promise.all([
    gustoRequest<any>(path, { userId }),
    gustoRequest<any>(`${path}/onboarding_status`, { userId }),
    gustoRequest<any[]>(`${path}/bank_accounts`, { userId }),
  ]);
  if (company?.uuid !== integration.companyId || !Array.isArray(accounts)) {
    throw new GustoProviderError("Gusto returned an invalid company response.", 502, "invalid_response");
  }
  // API supports one default company bank account. Never infer verification
  // from Plaid or expose routing/account numbers, cached balances or tokens.
  if (accounts.length > 1) throw new GustoProviderError("Gusto returned multiple funding accounts; the default cannot be determined safely.", 409, "funding_ambiguous");
  const account = accounts[0];
  const blockers: string[] = (onboarding?.onboarding_steps ?? [])
    .filter((step: any) => step.required && !step.completed).map((step: any) => `Complete Gusto setup: ${step.title ?? step.id}`);
  if (onboarding?.onboarding_completed !== true && !blockers.length) blockers.push("Gusto company onboarding is incomplete");
  if (account?.verification_status !== "verified") blockers.push("Gusto funding account is not verified");
  // Gusto generates payrolls only for approved companies; demo companies are approved via an extra API call.
  const companyStatus: string | null = typeof company.company_status === "string" ? company.company_status : null;
  if (companyStatus && companyStatus !== "Approved") blockers.push(`Gusto company status is "${companyStatus}" — payrolls are generated once Gusto approves the company`);
  await db.update(gustoIntegrations).set({
    fundingAccountId: account?.uuid ?? null, fundingStatus: account?.verification_status ?? "not_connected",
    state: "connected", lastError: null, lastSyncedAt: new Date(), updatedAt: new Date(),
  }).where(eq(gustoIntegrations.id, integration.id));
  return {
    configured: true, available: true, state: "connected", companyId: integration.companyId,
    companyName: company.name ?? company.trade_name ?? "Gusto company", environment: integration.environment,
    onboardingComplete: onboarding?.onboarding_completed === true, blockers, companyStatus,
    fundingAccount: account ? { id: account.uuid, status: account.verification_status, name: account.name,
      accountMask: typeof account.hidden_account_number === "string" ? account.hidden_account_number.replace(/\D/g, "").slice(-4) : null } : null,
    lastSyncedAt: new Date().toISOString(),
  };
}

export async function syncEmployees(userId: string) {
  const integration = await companyIntegration(userId);
  const [providerEmployees, localEmployees, mappings] = await Promise.all([
    allGustoEmployees(userId, integration.companyId!),
    db.select().from(employees).where(eq(employees.status, "active")),
    db.select().from(gustoEmployeeMappings),
  ]);
  const synced: Array<{ employeeId: string; gustoEmployeeId: string; onboardingStatus: string; paymentMethodStatus: string }> = [];
  const staleMappingIds: string[] = [];
  for (const employee of localEmployees) {
    const old = mappings.find(row => row.employeeId === employee.id && row.companyId === integration.companyId && row.environment === integration.environment);
    const matches = old ? providerEmployees.filter(row => row.uuid === old.gustoEmployeeId)
      : providerEmployees.filter(row => row.email && employee.email && String(row.email).toLowerCase() === employee.email.toLowerCase());
    const localDuplicate = employee.email && localEmployees.filter(row => row.email?.toLowerCase() === employee.email!.toLowerCase()).length > 1;
    const match = matches.length === 1 && (old || !localDuplicate) ? matches[0] : null;
    if (!match?.uuid || match.terminated === true) {
      // Invalidate stale readiness if an employee disappeared from the company.
      if (old) staleMappingIds.push(old.id);
      continue;
    }
    const method = await gustoRequest<any>(`/v1/employees/${encodeURIComponent(match.uuid)}/payment_method`, { userId });
    const paymentMethodStatus = method?.type === "Direct Deposit" && Array.isArray(method.splits) && method.splits.length > 0 ? "complete" : "incomplete";
    const onboardingStatus = match.onboarding_status === "onboarding_completed" || match.onboarding_status === "complete" ? "complete" : String(match.onboarding_status ?? "unknown");
    synced.push({ employeeId: employee.id, gustoEmployeeId: match.uuid, onboardingStatus, paymentMethodStatus });
  }
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('gusto-company-connect'))`);
    const [current] = await tx.select().from(gustoIntegrations).where(eq(gustoIntegrations.userId, userId));
    if (!current?.encryptedAccessToken || current.id !== integration.id ||
        current.companyId !== integration.companyId || current.environment !== integration.environment) {
      throw new GustoConfigurationError("The company connection changed. Refresh before syncing employees.");
    }
    for (const id of staleMappingIds) {
      await tx.update(gustoEmployeeMappings).set({ onboardingStatus: "unknown", paymentMethodStatus: "unknown", lastSyncedAt: new Date() }).where(eq(gustoEmployeeMappings.id, id));
    }
    for (const item of synced) {
      const values = { ...item, companyId: integration.companyId, environment: integration.environment, lastSyncedAt: new Date() };
      await tx.insert(gustoEmployeeMappings).values(values).onConflictDoUpdate({
        target: gustoEmployeeMappings.employeeId, set: { ...values, updatedAt: new Date() },
      });
    }
  });
  return synced;
}

export async function employeeReadiness(userId: string) {
  const integration = await db.query.gustoIntegrations.findFirst({ where: eq(gustoIntegrations.userId, userId) });
  const rows = await db.select({ employee: employees, mapping: gustoEmployeeMappings }).from(employees)
    .leftJoin(gustoEmployeeMappings, and(eq(employees.id, gustoEmployeeMappings.employeeId),
      eq(gustoEmployeeMappings.companyId, integration?.companyId ?? ""),
      eq(gustoEmployeeMappings.environment, gustoEnvironment())))
    .where(eq(employees.status, "active"));
  return rows.map(({ employee, mapping }) => {
    const blockers = [];
    if (!mapping) blockers.push("Employee is not synchronized to this Gusto company");
    if (mapping && mapping.onboardingStatus !== "complete") blockers.push("Gusto onboarding is incomplete");
    if (mapping && mapping.paymentMethodStatus !== "complete") blockers.push("Gusto direct deposit setup is incomplete");
    if (employee.employmentType !== "w2") blockers.push("Contractors require Gusto contractor payroll, not W-2 payroll");
    return {
      id: employee.id, name: employee.name, ready: blockers.length === 0, blockers, gustoEmployeeId: mapping?.gustoEmployeeId ?? null,
      // Gusto's own states, so the UI can say "invitation sent" or "not found" instead of a generic blocker.
      onboardingStatus: mapping?.onboardingStatus ?? null, paymentMethodStatus: mapping?.paymentMethodStatus ?? null,
    };
  });
}

/**
 * Gusto's response shape for send_test_deposits isn't documented: accept
 * deposit_1/deposit_2 or a two-item list, and only real micro-deposit amounts.
 */
export function testDepositAmounts(body: any): [number, number] | null {
  const pairs = [
    [body?.deposit_1, body?.deposit_2],
    Array.isArray(body?.deposits) ? body.deposits : null,
    Array.isArray(body) ? body : null,
  ];
  for (const pair of pairs) {
    if (!pair || pair.length !== 2) continue;
    const amounts = pair.map((value: any) => Number(value && typeof value === "object" ? value.amount : value));
    if (amounts.every((amount: number) => Number.isFinite(amount) && amount > 0 && amount < 1)) return [amounts[0], amounts[1]];
  }
  return null;
}

/**
 * Demo only: Gusto doesn't send real micro-deposits in demo. Simulate them with
 * Gusto's demo endpoint, then confirm them through the normal verify endpoint.
 */
export async function verifyDemoFunding(userId: string) {
  const integration = await companyIntegration(userId);
  if (integration.environment !== "demo" || gustoEnvironment() !== "demo") {
    throw new GustoProviderError("Test deposits are only available for demo companies.", 409, "demo_only");
  }
  const path = `/v1/companies/${integration.companyId}/bank_accounts`;
  const accounts = await gustoRequest<any[]>(path, { userId });
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new GustoProviderError("Add a funding bank account in Gusto first.", 409, "funding_missing");
  }
  if (accounts.length > 1) throw new GustoProviderError("Gusto returned multiple funding accounts; the default cannot be determined safely.", 409, "funding_ambiguous");
  const account = accounts[0];
  if (account.verification_status !== "verified") {
    const deposits = await gustoRequest<any>(`${path}/${account.uuid}/send_test_deposits`, { userId, method: "POST" });
    const amounts = testDepositAmounts(deposits);
    if (!amounts) throw new GustoProviderError("Gusto returned test deposits in an unexpected format.", 502, "invalid_response");
    await gustoRequest(`${path}/${account.uuid}/verify`, { userId, method: "PUT", body: { deposit_1: amounts[0], deposit_2: amounts[1] } });
  }
  return syncCompany(userId);
}

/**
 * Demo only: Gusto requires companies to be approved before it generates
 * payrolls. In production Gusto does this itself; in demo there is an endpoint.
 */
export async function approveDemoCompany(userId: string) {
  const integration = await companyIntegration(userId);
  if (integration.environment !== "demo" || gustoEnvironment() !== "demo") {
    throw new GustoProviderError("Only demo companies can be approved from here. Gusto approves production companies itself.", 409, "demo_only");
  }
  const path = `/v1/companies/${integration.companyId}`;
  const onboarding = await gustoRequest<any>(`${path}/onboarding_status`, { userId });
  if (onboarding?.onboarding_completed !== true) {
    // Gusto's own finish step; it reports which required steps are still open.
    await gustoRequest(`${path}/finish_onboarding`, { userId, method: "PUT" });
  }
  await gustoRequest(`${path}/approve`, { userId, method: "PUT" });
  return syncCompany(userId);
}

export type UpcomingPayroll = { payrollId: string; periodStart: string; periodEnd: string; payDate: string };

/** Gusto's upcoming regular payrolls: the periods and check dates a pay run must match. */
export async function upcomingPayrolls(userId: string): Promise<UpcomingPayroll[]> {
  const integration = await companyIntegration(userId);
  const rows = await gustoRequest<any[]>(`/v1/companies/${integration.companyId}/payrolls?processing_statuses=unprocessed&payroll_types=regular&per=100&page=1`, { userId });
  if (!Array.isArray(rows)) throw new GustoProviderError("Gusto returned an invalid payroll list.", 502, "invalid_response");
  return rows
    .filter((row) => !row.off_cycle && !row.processed && row.pay_period?.start_date && row.pay_period?.end_date && row.check_date)
    .map((row) => ({ payrollId: String(row.payroll_uuid), periodStart: row.pay_period.start_date, periodEnd: row.pay_period.end_date, payDate: row.check_date }))
    .sort((a, b) => a.payDate.localeCompare(b.payDate))
    .slice(0, 6);
}

export const GUSTO_FLOW_TYPES = new Set(["company_onboarding", "add_bank_info", "verify_bank_info", "add_employees", "employee_management", "payroll_history", "run_payroll"]);

export async function createFlow(userId: string, flowType: string) {
  const integration = await companyIntegration(userId);
  if (!GUSTO_FLOW_TYPES.has(flowType)) throw new GustoProviderError("Unsupported Gusto setup flow.", 400, "invalid_flow");
  if (flowType === "run_payroll" && integration.environment === "production" && process.env.GUSTO_LIVE_PAYROLL_ENABLED !== "true") {
    throw new GustoProviderError("Live payroll is disabled until production approval and explicit live-release authorization.", 409, "live_payroll_disabled");
  }
  const result = await gustoRequest<any>(`/v1/companies/${integration.companyId}/flows`, { userId, method: "POST", body: { flow_type: flowType } });
  const url = new URL(result?.url);
  const origin = integration.environment === "demo" ? "https://flows.gusto-demo.com" : "https://flows.gusto.com";
  if (url.origin !== origin || url.username || url.password || !url.pathname.startsWith("/flows/")) {
    throw new GustoProviderError("Gusto returned an invalid setup link.", 502, "invalid_response");
  }
  return { url: url.toString() };
}
