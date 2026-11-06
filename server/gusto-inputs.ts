import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "./db";
import { employees, gustoEmployeeMappings, payrollRecords, payrollWorksheets } from "@shared/schema";

export function payrollDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Dates must use YYYY-MM-DD format");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid calendar date");
  return value;
}

export function payrollNumber(value: unknown, label: string) {
  if ((typeof value !== "string" && typeof value !== "number") || value === "" || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 999999999) {
    throw new Error(`${label} must be a valid non-negative number`);
  }
  return Number(value).toFixed(2);
}

export async function derivePayrollInputs(periodStart: string, periodEnd: string, explicit: unknown[], companyId: string, environment: string) {
  const [active, mappings] = await Promise.all([
    db.select().from(employees).where(eq(employees.status, "active")),
    db.select().from(gustoEmployeeMappings).where(and(eq(gustoEmployeeMappings.companyId, companyId), eq(gustoEmployeeMappings.environment, environment))),
  ]);
  let rows = explicit as any[];
  if (!rows.length) {
    const [records, worksheets] = await Promise.all([
      db.select().from(payrollRecords).where(and(gte(payrollRecords.periodStart, new Date(`${periodStart}T00:00:00Z`)), lte(payrollRecords.periodEnd, new Date(`${periodEnd}T23:59:59.999Z`)))),
      db.select().from(payrollWorksheets).where(and(gte(payrollWorksheets.periodStart, periodStart), lte(payrollWorksheets.periodEnd, periodEnd))),
    ]);
    const grouped = new Map<string, any>();
    for (const record of records) {
      const current = grouped.get(record.employeeId) ?? { employeeId: record.employeeId, hours: 0, grossEarnings: 0 };
      current.hours += Number(record.totalHours);
      current.grossEarnings += Number(record.grossPay);
      grouped.set(record.employeeId, current);
    }
    for (const worksheet of worksheets) if (!grouped.has(worksheet.employeeId)) {
      grouped.set(worksheet.employeeId, { employeeId: worksheet.employeeId, days: Number(worksheet.daysWorked), grossEarnings: Number(worksheet.grossPay) });
    }
    rows = [...grouped.values()];
  }
  if (!rows.length || rows.length > 10000) throw new Error("Choose between 1 and 10,000 payable employees.");
  const seen = new Set<string>();
  return rows.map(row => {
    const employee = active.find(employee => employee.id === row?.employeeId);
    if (!employee || seen.has(employee.id)) throw new Error("Payroll contains a duplicate or invalid active employee.");
    seen.add(employee.id);
    if (employee.employmentType !== "w2") throw new Error("Use Gusto contractor payroll for 1099 workers.");
    const mapping = mappings.find(mapping => mapping.employeeId === employee.id);
    if (!mapping) throw new Error(`Sync ${employee.name} with this Gusto company before preparing payroll.`);
    const grossEarnings = payrollNumber(row.grossEarnings ?? row.earnings ?? 0, "Estimated earnings");
    if (Number(grossEarnings) <= 0) throw new Error("Each employee must have nonzero estimated earnings.");
    return {
      employeeId: employee.id, gustoEmployeeId: mapping.gustoEmployeeId,
      hours: payrollNumber(row.hours ?? 0, "Hours"), days: payrollNumber(row.days ?? 0, "Days"),
      grossEarnings, reimbursements: payrollNumber(row.reimbursements ?? 0, "Reimbursements"),
      // Local historical deductions/tax/net estimates are not tax instructions.
      deductions: "0.00", taxes: "0.00", netPay: "0.00",
    };
  });
}
