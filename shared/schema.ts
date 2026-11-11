import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, date, boolean, jsonb, json, index, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { emailListSchema } from "./client-emails";
import { LINE_ITEM_STATUSES } from "./line-item-status";

// Decimal columns travel as strings, but forms often post a parsed number
// (e.g. hours worked); accept either and validate the string form.
function numericString(label: string) {
  return z.preprocess(
    (value) => (typeof value === "number" && Number.isFinite(value) ? String(value) : value),
    z
      .string({ invalid_type_error: `${label} must be a valid number`, required_error: `${label} is required` })
      .min(1, `${label} is required`)
      .refine(
        (val) => !isNaN(parseFloat(val)) && isFinite(Number(val)),
        `${label} must be a valid number`
      ),
  );
}

function positiveNumericString(label: string) {
  return numericString(label).refine(
    (val) => parseFloat(val) > 0,
    `${label} must be greater than zero`
  );
}

function nonNegativeNumericString(label: string) {
  return numericString(label).refine(
    (val) => parseFloat(val) >= 0,
    `${label} must not be negative`
  );
}

// Login sessions, read and written by connect-pg-simple (server/index.ts).
// Matches its table.sql; not used through Drizzle.
export const sessions = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
}, (table) => [index("IDX_session_expire").on(table.expire)]);

// Users table for authentication
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  companyName: text("company_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  displayName: text("display_name"),
  isAdmin: boolean("is_admin").default(false).notNull(),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Invite codes — admin-generated single-use codes for new user registration
export const invites = pgTable("invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  label: text("label"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  usedAt: timestamp("used_at"),
  usedByUserId: varchar("used_by_user_id").references(() => users.id),
});

export const insertInviteSchema = createInsertSchema(invites).omit({ id: true, createdAt: true, usedAt: true, usedByUserId: true });
export type InsertInvite = z.infer<typeof insertInviteSchema>;
export type Invite = typeof invites.$inferSelect;

// OAuth accounts — links social identity providers to local users
export const oauthAccounts = pgTable("oauth_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  providerId: text("provider_id").notNull(),
  email: text("email"),
});

export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type InsertOAuthAccount = typeof oauthAccounts.$inferInsert;

// Clients table
export const clients = pgTable("clients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  generalContractorName: text("general_contractor_name"),
  email: text("email"),
  // Other contacts at the company (e.g. accounts payable); `email` is the primary.
  additionalEmails: jsonb("additional_emails").$type<string[]>().default([]).notNull(),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const clientsRelations = relations(clients, ({ many }) => ({
  jobs: many(jobs),
  invoices: many(invoices),
}));

export const insertClientSchema = createInsertSchema(clients)
  .omit({ id: true, createdAt: true })
  .extend({ additionalEmails: emailListSchema.optional() });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clients.$inferSelect;

// Jobs table
export const jobs = pgTable("jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  address: text("address"),
  status: text("status").notNull().default("quoted"), // quoted, scheduled, in_progress, completed
  squareFootage: decimal("square_footage", { precision: 10, scale: 2 }),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  estimatedTotal: decimal("estimated_total", { precision: 10, scale: 2 }),
  referenceCodes: jsonb("reference_codes").$type<{ label: string; code: string }[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  client: one(clients, {
    fields: [jobs.clientId],
    references: [clients.id],
  }),
  lineItems: many(lineItems),
  materials: many(jobMaterials),
  invoices: many(invoices),
  employeeAssignments: many(employeeAssignments),
}));

export const insertJobSchema = createInsertSchema(jobs)
  .omit({ id: true, createdAt: true })
  .extend({
    startDate: z.coerce.date().optional().nullable(),
    endDate: z.coerce.date().optional().nullable(),
    squareFootage: z.coerce.string().optional().nullable(),
    estimatedTotal: z.coerce.string().optional().nullable(),
    referenceCodes: z.array(z.object({ label: z.string(), code: z.string() })).optional().nullable(),
  });
export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobs.$inferSelect;

// Materials purchased for a job
export const jobMaterials = pgTable("job_materials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").references(() => jobs.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  purchaseDate: date("purchase_date").notNull(),
  vendor: text("vendor"),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull(),
  unit: text("unit").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const jobMaterialsRelations = relations(jobMaterials, ({ one }) => ({
  job: one(jobs, {
    fields: [jobMaterials.jobId],
    references: [jobs.id],
  }),
}));

export const insertJobMaterialSchema = createInsertSchema(jobMaterials)
  .omit({ id: true, createdAt: true })
  .extend({
    name: z.string().trim().min(1, "Material name is required"),
    purchaseDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Purchase date is required"),
    quantity: positiveNumericString("Quantity"),
    price: nonNegativeNumericString("Price"),
  });
export type InsertJobMaterial = z.infer<typeof insertJobMaterialSchema>;
export type JobMaterial = typeof jobMaterials.$inferSelect;

// Line Items table (for job pricing breakdown)
export const lineItems = pgTable("line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  invoiceId: varchar("invoice_id").references(() => invoices.id, { onDelete: "cascade" }),
  category: text("category").notNull(), // materials, labor, square_footage, other
  description: text("description").notNull(),
  quantity: decimal("quantity", { precision: 10, scale: 2 }).notNull(),
  unit: text("unit").notNull(), // sqft, hours, each, gallon, etc.
  rate: decimal("rate", { precision: 10, scale: 2 }).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  isChangeOrder: boolean("is_change_order").default(false),
  changeOrderReason: text("change_order_reason"),
  section: text("section"),
  refs: text("refs"),
  // Work status set by hand: pending | in_progress | completed. Internal; not printed.
  status: text("status").notNull().default("pending"),
});

export const lineItemsRelations = relations(lineItems, ({ one }) => ({
  job: one(jobs, {
    fields: [lineItems.jobId],
    references: [jobs.id],
  }),
  invoice: one(invoices, {
    fields: [lineItems.invoiceId],
    references: [invoices.id],
  }),
}));

const lineItemSchema = createInsertSchema(lineItems)
  .omit({ id: true })
  .extend({
    quantity: positiveNumericString("Quantity"),
    rate: positiveNumericString("Rate"),
    amount: positiveNumericString("Amount"),
    status: z.enum(LINE_ITEM_STATUSES).optional(),
  });
export const insertLineItemSchema = lineItemSchema.superRefine(validateLineItemAmount);

export const updateLineItemSchema = lineItemSchema.partial().superRefine(validateLineItemAmount);
export type InsertLineItem = z.infer<typeof insertLineItemSchema>;
export type LineItem = typeof lineItems.$inferSelect;

// Invoices table
export const invoices = pgTable("invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceNumber: text("invoice_number").notNull().unique(),
  clientId: varchar("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").references(() => jobs.id, { onDelete: "set null" }),
  status: text("status").notNull().default("draft"), // draft, sent, paid, overdue, partial
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).notNull(),
  taxRate: decimal("tax_rate", { precision: 5, scale: 2 }).default("0"),
  taxAmount: decimal("tax_amount", { precision: 10, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).notNull(),
  amountPaid: decimal("amount_paid", { precision: 10, scale: 2 }).default("0"),
  balance: decimal("balance", { precision: 10, scale: 2 }).notNull(),
  issueDate: timestamp("issue_date").defaultNow().notNull(),
  dueDate: timestamp("due_date").notNull(),
  notes: text("notes"),
  termsAndConditions: text("terms_and_conditions"),
  lastReminderSent: timestamp("last_reminder_sent"),
  reminderCount: integer("reminder_count").default(0),
  remindersPaused: boolean("reminders_paused").default(false).notNull(),
  payToken: text("pay_token").unique(),
  payTokenExpiresAt: timestamp("pay_token_expires_at"),
  // Addresses this invoice, its reminders and change orders are sent to.
  // Null for older invoices, which fall back to the client's primary email.
  recipientEmails: jsonb("recipient_emails").$type<string[]>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  client: one(clients, {
    fields: [invoices.clientId],
    references: [clients.id],
  }),
  job: one(jobs, {
    fields: [invoices.jobId],
    references: [jobs.id],
  }),
  lineItems: many(lineItems),
  payments: many(payments),
  changeOrders: many(changeOrders),
}));

export const insertInvoiceSchema = createInsertSchema(invoices)
  .omit({ id: true, createdAt: true })
  .extend({
    issueDate: z.coerce.date().optional(),
    dueDate: z.coerce.date(),
    lastReminderSent: z.coerce.date().optional().nullable(),
    subtotal: nonNegativeNumericString("Subtotal"),
    taxRate: z.coerce.string().optional(),
    taxAmount: z.coerce.string().optional(),
    total: nonNegativeNumericString("Total"),
    amountPaid: z.coerce.string().optional(),
    balance: nonNegativeNumericString("Balance"),
    remindersPaused: z.boolean().optional(),
    recipientEmails: emailListSchema.optional().nullable(),
  });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

// Payments table
export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull(), // cash, check, credit_card, bank_transfer
  paymentDate: timestamp("payment_date").defaultNow().notNull(),
  referenceNumber: text("reference_number"),
  notes: text("notes"),
});

export const paymentsRelations = relations(payments, ({ one }) => ({
  invoice: one(invoices, {
    fields: [payments.invoiceId],
    references: [invoices.id],
  }),
}));

export const insertPaymentSchema = createInsertSchema(payments)
  .omit({ id: true })
  .extend({
    paymentDate: z.coerce.date().optional(),
    amount: z.coerce.number({ required_error: "Amount is required", invalid_type_error: "Amount must be a number" }).positive("Amount must be positive").transform(String),
    paymentMethod: z.enum(["cash", "check", "credit_card", "bank_transfer"], {
      required_error: "Payment method is required",
      invalid_type_error: "Invalid payment method",
    }),
  });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof payments.$inferSelect;

// Change Orders table — one invoice can have many change orders
export const changeOrders = pgTable("change_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending"), // pending, approved, rejected
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const changeOrdersRelations = relations(changeOrders, ({ one }) => ({
  invoice: one(invoices, {
    fields: [changeOrders.invoiceId],
    references: [invoices.id],
  }),
}));

export const insertChangeOrderSchema = createInsertSchema(changeOrders)
  .omit({ id: true, createdAt: true })
  .extend({
    amount: numericString("Amount"),
    status: z.enum(["draft", "pending", "approved", "rejected", "invoiced"]).optional(),
  });
export type InsertChangeOrder = z.infer<typeof insertChangeOrderSchema>;
export type ChangeOrder = typeof changeOrders.$inferSelect;

// Employees table
export const employees = pgTable("employees", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  dayRate: decimal("day_rate", { precision: 10, scale: 2 }).notNull(),
  position: text("position"),
  hireDate: timestamp("hire_date"),
  status: text("status").notNull().default("active"), // active, inactive
  // Payroll / tax fields
  employmentType: text("employment_type").default("w2"), // w2, 1099
  payType: text("pay_type").default("hourly"), // hourly, salary, day
  annualSalary: decimal("annual_salary", { precision: 10, scale: 2 }),
  filingStatus: text("filing_status").default("single"), // single, married, head_of_household
  // State withholding allowances (e.g. NY IT-2104 box 1). Null until an admin enters one.
  taxAllowances: integer("tax_allowances"),
  stateCode: text("state_code").default("CA"),
  taxpayerIdNumber: text("taxpayer_id_number"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Direct deposit self-service token
  directDepositToken: text("direct_deposit_token"),
  directDepositTokenExpiry: timestamp("direct_deposit_token_expiry"),
  directDepositLinkUserId: varchar("direct_deposit_link_user_id"),
});

export const employeesRelations = relations(employees, ({ many }) => ({
  assignments: many(employeeAssignments),
  timeEntries: many(timeEntries),
  payrollRecords: many(payrollRecords),
  payrollWorksheets: many(payrollWorksheets),
  deductions: many(employeeDeductions),
}));

export const insertEmployeeSchema = createInsertSchema(employees)
  .omit({ id: true, createdAt: true })
  .extend({
    hireDate: z.coerce.date().optional().nullable(),
    dayRate: positiveNumericString("Day rate"),
    employmentType: z.enum(["w2", "1099"]).optional(),
    payType: z.enum(["hourly", "salary", "day"]).optional(),
    annualSalary: z.coerce.string().optional().nullable(),
    filingStatus: z.enum(["single", "married", "head_of_household"]).optional(),
    taxAllowances: z.union([z.null(), z.coerce.number().int().min(0).max(20)]).optional(),
    stateCode: z.string().length(2).optional(),
  });
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employees.$inferSelect;

// Employee Deductions — pre-tax or post-tax recurring deductions per employee
export const employeeDeductions = pgTable("employee_deductions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  deductionType: text("deduction_type").notNull().default("fixed"), // fixed, percent
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  category: text("category").notNull().default("other"), // health, dental, vision, retirement, garnishment, other
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const employeeDeductionsRelations = relations(employeeDeductions, ({ one }) => ({
  employee: one(employees, { fields: [employeeDeductions.employeeId], references: [employees.id] }),
}));

export const insertEmployeeDeductionSchema = createInsertSchema(employeeDeductions).omit({ id: true, createdAt: true });
export type InsertEmployeeDeduction = z.infer<typeof insertEmployeeDeductionSchema>;
export type EmployeeDeduction = typeof employeeDeductions.$inferSelect;

// Payroll Settings — global single-row config (pay frequency, etc.)
export const payrollSettings = pgTable("payroll_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payFrequency: text("pay_frequency").notNull().default("biweekly"), // weekly, biweekly, semimonthly, monthly
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPayrollSettingsSchema = createInsertSchema(payrollSettings).omit({ id: true, updatedAt: true });
export type InsertPayrollSettings = z.infer<typeof insertPayrollSettingsSchema>;
export type PayrollSettings = typeof payrollSettings.$inferSelect;

// Employee Assignments to Jobs
export const employeeAssignments = pgTable("employee_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  assignedDate: timestamp("assigned_date").defaultNow().notNull(),
});

export const employeeAssignmentsRelations = relations(employeeAssignments, ({ one }) => ({
  employee: one(employees, {
    fields: [employeeAssignments.employeeId],
    references: [employees.id],
  }),
  job: one(jobs, {
    fields: [employeeAssignments.jobId],
    references: [jobs.id],
  }),
}));

export const insertEmployeeAssignmentSchema = createInsertSchema(employeeAssignments).omit({ id: true });
export type InsertEmployeeAssignment = z.infer<typeof insertEmployeeAssignmentSchema>;
export type EmployeeAssignment = typeof employeeAssignments.$inferSelect;

// Time Entries for employees
export const timeEntries = pgTable("time_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  jobId: varchar("job_id").references(() => jobs.id, { onDelete: "set null" }),
  date: timestamp("date").notNull(),
  hoursWorked: decimal("hours_worked", { precision: 5, scale: 2 }).notNull(),
  description: text("description"),
  source: text("source").notNull().default("manual"), // manual | sms
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({
  employee: one(employees, {
    fields: [timeEntries.employeeId],
    references: [employees.id],
  }),
  job: one(jobs, {
    fields: [timeEntries.jobId],
    references: [jobs.id],
  }),
}));

export const insertTimeEntrySchema = createInsertSchema(timeEntries)
  .omit({ id: true, createdAt: true })
  .extend({
    date: z.coerce.date(),
    hoursWorked: positiveNumericString("Hours worked").refine(
      (val) => parseFloat(val) <= 24,
      "Hours cannot exceed 24 in a single entry"
    ),
  });
export type InsertTimeEntry = z.infer<typeof insertTimeEntrySchema>;
export type TimeEntry = typeof timeEntries.$inferSelect;

// Payroll Records
export const payrollRecords = pgTable("payroll_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  totalHours: decimal("total_hours", { precision: 10, scale: 2 }).notNull(),
  regularHours: decimal("regular_hours", { precision: 10, scale: 2 }).default("0"),
  overtimeHours: decimal("overtime_hours", { precision: 10, scale: 2 }).default("0"),
  dayRate: decimal("day_rate", { precision: 10, scale: 2 }).notNull(),
  regularPay: decimal("regular_pay", { precision: 10, scale: 2 }).default("0"),
  overtimePay: decimal("overtime_pay", { precision: 10, scale: 2 }).default("0"),
  grossPay: decimal("gross_pay", { precision: 10, scale: 2 }).notNull(),
  taxWithheld: decimal("tax_withheld", { precision: 10, scale: 2 }).default("0"),
  deductions: decimal("deductions", { precision: 10, scale: 2 }).default("0"),
  deductionsBreakdown: jsonb("deductions_breakdown").$type<{ label: string; amount: number; category: string }[]>().default([]),
  netPay: decimal("net_pay", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"), // pending, paid
  paidDate: timestamp("paid_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const payrollRecordsRelations = relations(payrollRecords, ({ one }) => ({
  employee: one(employees, {
    fields: [payrollRecords.employeeId],
    references: [employees.id],
  }),
}));

export const insertPayrollRecordSchema = createInsertSchema(payrollRecords)
  .omit({ id: true, createdAt: true })
  .extend({
    totalHours: positiveNumericString("Total hours"),
    regularHours: z.coerce.string().optional(),
    overtimeHours: z.coerce.string().optional(),
    dayRate: positiveNumericString("Day rate"),
    regularPay: z.coerce.string().optional(),
    overtimePay: z.coerce.string().optional(),
    grossPay: positiveNumericString("Gross pay"),
    taxWithheld: z.coerce.string().optional(),
    deductions: z.coerce.string().optional(),
    deductionsBreakdown: z.array(z.object({ label: z.string(), amount: z.number(), category: z.string() })).optional(),
    netPay: nonNegativeNumericString("Net pay"),
  });
export type InsertPayrollRecord = z.infer<typeof insertPayrollRecordSchema>;
export type PayrollRecord = typeof payrollRecords.$inferSelect;

// Payroll Worksheets — Gusto-assisted, reviewable payroll entries. These are
// intentionally separate from payroll_records, which represent payroll runs.
export const payrollWorksheets = pgTable("payroll_worksheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => employees.id, { onDelete: "restrict" }),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  payDate: date("pay_date").notNull(),
  daysWorked: decimal("days_worked", { precision: 10, scale: 2 }).notNull(),
  dailyGross: decimal("daily_gross", { precision: 12, scale: 2 }).notNull(),
  grossPay: decimal("gross_pay", { precision: 12, scale: 2 }).notNull(),
  gustoDeductionsBreakdown: jsonb("gusto_deductions_breakdown")
    .$type<{ label: string; amount: number; category?: string; gustoCode?: string }[]>()
    .notNull()
    .default([]),
  totalDeductions: decimal("total_deductions", { precision: 12, scale: 2 }).notNull(),
  netPay: decimal("net_pay", { precision: 12, scale: 2 }).notNull(),
  status: text("status").notNull().default("draft"), // draft, exported, confirmed
  exportedAt: timestamp("exported_at"),
  gustoConfirmationReference: text("gusto_confirmation_reference"),
  gustoConfirmedAt: timestamp("gusto_confirmed_at"),
  gustoConfirmationNotes: text("gusto_confirmation_notes"),
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  confirmedByUserId: varchar("confirmed_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const payrollWorksheetsRelations = relations(payrollWorksheets, ({ one }) => ({
  employee: one(employees, {
    fields: [payrollWorksheets.employeeId],
    references: [employees.id],
  }),
  createdBy: one(users, {
    fields: [payrollWorksheets.createdByUserId],
    references: [users.id],
    relationName: "payrollWorksheetCreator",
  }),
  confirmedBy: one(users, {
    fields: [payrollWorksheets.confirmedByUserId],
    references: [users.id],
    relationName: "payrollWorksheetConfirmer",
  }),
}));

const gustoDeductionBreakdownSchema = z.array(z.object({
  label: z.string().trim().min(1, "Deduction label is required"),
  amount: z.coerce.number().finite().min(0, "Deduction amount must not be negative"),
  category: z.string().trim().optional(),
  gustoCode: z.string().trim().optional(),
}));

export const insertPayrollWorksheetSchema = createInsertSchema(payrollWorksheets)
  .omit({
    id: true,
    grossPay: true,
    totalDeductions: true,
    netPay: true,
    status: true,
    exportedAt: true,
    gustoConfirmationReference: true,
    gustoConfirmedAt: true,
    gustoConfirmationNotes: true,
    createdByUserId: true,
    confirmedByUserId: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    employeeId: z.string().trim().min(1, "Employee is required"),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    payDate: z.coerce.date(),
    daysWorked: nonNegativeNumericString("Days worked"),
    dailyGross: nonNegativeNumericString("Daily gross"),
    gustoDeductionsBreakdown: gustoDeductionBreakdownSchema.optional().default([]),
  });
export const updatePayrollWorksheetSchema = insertPayrollWorksheetSchema.partial();
export const confirmPayrollWorksheetSchema = z.object({
  gustoConfirmationReference: z.string().trim().min(1, "Gusto confirmation reference is required"),
  gustoConfirmedAt: z.coerce.date().optional(),
  gustoConfirmationNotes: z.string().trim().max(5000).optional().nullable(),
});
export type InsertPayrollWorksheet = typeof payrollWorksheets.$inferInsert;
export type PayrollWorksheet = typeof payrollWorksheets.$inferSelect;

// Google Tokens — per-user Gmail OAuth tokens (access + refresh)
export const googleTokens = pgTable("google_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at"),
  gmailEmail: text("gmail_email"),
  syncLabels: text("sync_labels").array().notNull().default(sql`ARRAY['INBOX']`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type GoogleToken = typeof googleTokens.$inferSelect;
export type InsertGoogleToken = typeof googleTokens.$inferInsert;

// Google Docs — separate per-user read-only OAuth tokens so document access
// cannot replace or change the scopes of a user's Gmail connection.
export const googleDocsTokens = pgTable("google_docs_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at"),
  googleEmail: text("google_email"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type GoogleDocsToken = typeof googleDocsTokens.$inferSelect;
export type InsertGoogleDocsToken = typeof googleDocsTokens.$inferInsert;

// Inbox Tasks — Gmail-synced email items shown as a per-user daily to-do list.
// Each user connects their own Gmail account; tasks are scoped to that user.
export const inboxTasks = pgTable("inbox_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  emailId: text("email_id").notNull(),
  subject: text("subject").notNull().default("(No subject)"),
  sender: text("sender").notNull(),
  senderEmail: text("sender_email"),
  snippet: text("snippet"),
  receivedAt: timestamp("received_at").notNull(),
  isRead: boolean("is_read").default(true),
  isDone: boolean("is_done").default(false).notNull(),
  dismissed: boolean("dismissed").default(false).notNull(),
  snoozedUntil: timestamp("snoozed_until"),
  permanentlyDeleted: boolean("permanently_deleted").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertInboxTaskSchema = createInsertSchema(inboxTasks).omit({ id: true, createdAt: true });
export type InsertInboxTask = z.infer<typeof insertInboxTaskSchema>;
export type InboxTask = typeof inboxTasks.$inferSelect;

// Onboarding Items — per-employee checklist (W-4, I-9, direct deposit, etc.)
export const onboardingItems = pgTable("onboarding_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().references(() => employees.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  completed: boolean("completed").notNull().default(false),
  completedDate: timestamp("completed_date"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertOnboardingItemSchema = createInsertSchema(onboardingItems).omit({ id: true });
export type InsertOnboardingItem = z.infer<typeof insertOnboardingItemSchema>;
export type OnboardingItem = typeof onboardingItems.$inferSelect;

export const DEFAULT_ONBOARDING_ITEMS = [
  "W-4 received",
  "I-9 verified",
  "Direct deposit info collected",
  "Employment agreement signed",
];

// Settings table for company info and email configuration
export const settings = pgTable("settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  companyName: text("company_name"),
  companyEmail: text("company_email"),
  companyPhone: text("company_phone"),
  companyAddress: text("company_address"),
  taxRate: decimal("tax_rate", { precision: 5, scale: 2 }).default("0"),
  invoicePrefix: text("invoice_prefix").default("INV"),
  invoiceTerms: text("invoice_terms"),
  reminderIntervals: jsonb("reminder_intervals").default([7, 14, 30]), // days after due date
  emailSettings: jsonb("email_settings"),
  lastInboxSync: timestamp("last_inbox_sync"),
  inboxSyncHour: integer("inbox_sync_hour").default(8), // 0-23, hour of day for daily inbox sync
  collectionsEnabled: boolean("collections_enabled").default(true).notNull(),
  reminderTones: jsonb("reminder_tones").$type<{ stage: number; label: string; subject: string; body: string }[]>(),
  // Lowest sequence number the next invoice may use (e.g. continue from old software). Null = no floor.
  invoiceNextNumber: integer("invoice_next_number"),
});

// Atomic invoice-number counters, one row per (scope, series, year). Scope is
// the business ("default" while JobsOxo runs one company); series lets credit
// notes or estimates get their own sequence later. Numbers are never reused.
export const invoiceCounters = pgTable("invoice_counters", {
  scope: text("scope").notNull(),
  series: text("series").notNull(),
  year: integer("year").notNull(),
  lastNumber: integer("last_number").notNull(),
}, (table) => [primaryKey({ columns: [table.scope, table.series, table.year] })]);

// Reminder Logs — history of every outbound reminder sent per invoice
export const reminderLogs = pgTable("reminder_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(), // email | sms
  stage: integer("stage").notNull(), // 1 = friendly, 2 = firm, 3 = final
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  success: boolean("success").notNull().default(true),
  errorMessage: text("error_message"),
});

// "Get on it": the team's shared notepad, shown on the dashboard and in
// Scheduling. One row per notepad; "get-on-it" is the only one today.
export const notepads = pgTable("notepads", {
  id: varchar("id").primaryKey(),
  content: text("content").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: varchar("updated_by").references(() => users.id, { onDelete: "set null" }),
});
export type Notepad = typeof notepads.$inferSelect;

// Every client email about an invoice (the invoice itself, change orders,
// reminders) and what Resend reported back, so people can see whether it
// arrived and, if not, why.
export const emailDeliveries = pgTable("email_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  invoiceId: varchar("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // invoice | change_order | reminder
  recipients: jsonb("recipients").$type<string[]>().notNull(),
  providerId: text("provider_id"), // Resend email id
  status: text("status").notNull(), // sent | delayed | delivered | complained | bounced | failed | suppressed
  detail: text("detail"), // plain-language reason shown to people
  providerReason: text("provider_reason"), // raw reason from Resend, for support
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastCheckedAt: timestamp("last_checked_at"),
}, (table) => [
  index("email_deliveries_invoice_idx").on(table.invoiceId),
  index("email_deliveries_provider_idx").on(table.providerId),
]);
export type EmailDelivery = typeof emailDeliveries.$inferSelect;

export const insertReminderLogSchema = createInsertSchema(reminderLogs).omit({ id: true, sentAt: true });
export type InsertReminderLog = z.infer<typeof insertReminderLogSchema>;
export type ReminderLog = typeof reminderLogs.$inferSelect;

export const insertSettingsSchema = createInsertSchema(settings)
  .omit({ id: true })
  .extend({
    taxRate: z.coerce.string().optional(),
    inboxSyncHour: z.number().int().min(0).max(23).optional().nullable(),
    invoiceNextNumber: z.union([z.null(), z.coerce.number().int().min(1).max(999_999_999)]).optional(),
  });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settings.$inferSelect;

// Job Documents table
export const jobDocuments = pgTable("job_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  fileData: text("file_data").notNull(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});

export const insertJobDocumentSchema = createInsertSchema(jobDocuments).omit({ id: true, uploadedAt: true });
export type InsertJobDocument = z.infer<typeof insertJobDocumentSchema>;
export type JobDocument = typeof jobDocuments.$inferSelect;

// Bank Accounts — Plaid-connected bank accounts (business or employee)
export const bankAccounts = pgTable("bank_accounts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  entityType: text("entity_type").notNull().default("business"), // business | employee
  entityId: varchar("entity_id"), // employee ID when entityType = employee
  plaidItemId: text("plaid_item_id").notNull(),
  plaidAccessToken: text("plaid_access_token").notNull(),
  plaidAccountId: text("plaid_account_id").notNull(),
  institutionName: text("institution_name").notNull(),
  accountName: text("account_name").notNull(),
  accountMask: text("account_mask").notNull(),
  accountType: text("account_type"),
  routingNumber: text("routing_number"), // From Plaid Auth; stored server-side only
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBankAccountSchema = createInsertSchema(bankAccounts).omit({ id: true, createdAt: true });
export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;
export type BankAccount = typeof bankAccounts.$inferSelect;

// Plaid Transactions — persisted bank transactions for reconciliation
export const plaidTransactions = pgTable("plaid_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  plaidTransactionId: text("plaid_transaction_id").notNull().unique(),
  plaidAccountId: text("plaid_account_id").notNull(),
  date: timestamp("date").notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  name: text("name").notNull(),
  merchantName: text("merchant_name"),
  pending: boolean("pending").default(false).notNull(),
  matchedPaymentId: varchar("matched_payment_id").references(() => payments.id, { onDelete: "set null" }),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
});

export const insertPlaidTransactionSchema = createInsertSchema(plaidTransactions).omit({ id: true, syncedAt: true });
export type InsertPlaidTransaction = z.infer<typeof insertPlaidTransactionSchema>;
export type StoredPlaidTransaction = typeof plaidTransactions.$inferSelect;

// Gusto Embedded Payroll integration. This is intentionally singleton-tenant
// data (the application currently has one company), but userId provides an
// ownership boundary for credentials and admin operations.
export const gustoIntegrations = pgTable("gusto_integrations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  companyId: text("company_id"),
  environment: text("environment").notNull().default("demo"),
  state: text("state").notNull().default("not_connected"), // not_connected, connected, error
  fundingAccountId: text("funding_account_id"),
  fundingStatus: text("funding_status"),
  encryptedAccessToken: text("encrypted_access_token"),
  lastError: text("last_error"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type GustoIntegration = typeof gustoIntegrations.$inferSelect;
export type InsertGustoIntegration = typeof gustoIntegrations.$inferInsert;

export const gustoEmployeeMappings = pgTable("gusto_employee_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").notNull().unique().references(() => employees.id, { onDelete: "cascade" }),
  gustoEmployeeId: text("gusto_employee_id").notNull().unique(),
  companyId: text("company_id"),
  environment: text("environment"),
  onboardingStatus: text("onboarding_status").notNull().default("unknown"),
  paymentMethodStatus: text("payment_method_status").notNull().default("unknown"),
  lastSyncedAt: timestamp("last_synced_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type GustoEmployeeMapping = typeof gustoEmployeeMappings.$inferSelect;

export const gustoPayrollRuns = pgTable("gusto_payroll_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  gustoPayrollId: text("gusto_payroll_id").unique(),
  companyId: text("company_id"),
  environment: text("environment"),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  payDate: date("pay_date").notNull(),
  status: text("status").notNull().default("draft"),
  providerRequestState: text("provider_request_state").notNull().default("idle"),
  expectedDebitDate: date("expected_debit_date"),
  checkDate: date("check_date"),
  grossTotal: decimal("gross_total", { precision: 14, scale: 2 }).notNull().default("0"),
  netTotal: decimal("net_total", { precision: 14, scale: 2 }).notNull().default("0"),
  debitTotal: decimal("debit_total", { precision: 14, scale: 2 }).notNull().default("0"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  submissionActorUserId: varchar("submission_actor_user_id").references(() => users.id),
  submittedAt: timestamp("submitted_at"),
  lastProviderStatus: text("last_provider_status"),
  lastError: text("last_error"),
  blockers: jsonb("blockers").$type<string[]>().notNull().default([]),
  reviewFingerprint: text("review_fingerprint"),
  canCancel: boolean("can_cancel").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type GustoPayrollRun = typeof gustoPayrollRuns.$inferSelect;

export const gustoPayrollItems = pgTable("gusto_payroll_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => gustoPayrollRuns.id, { onDelete: "cascade" }),
  employeeId: varchar("employee_id").notNull().references(() => employees.id),
  gustoEmployeeId: text("gusto_employee_id"),
  hours: decimal("hours", { precision: 10, scale: 2 }).notNull().default("0"),
  days: decimal("days", { precision: 10, scale: 2 }).notNull().default("0"),
  grossEarnings: decimal("gross_earnings", { precision: 14, scale: 2 }).notNull().default("0"),
  deductions: decimal("deductions", { precision: 14, scale: 2 }).notNull().default("0"),
  taxes: decimal("taxes", { precision: 14, scale: 2 }).notNull().default("0"),
  reimbursements: decimal("reimbursements", { precision: 14, scale: 2 }).notNull().default("0"),
  netPay: decimal("net_pay", { precision: 14, scale: 2 }).notNull().default("0"),
  providerResult: jsonb("provider_result"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type GustoPayrollItem = typeof gustoPayrollItems.$inferSelect;

export const gustoWebhookEvents = pgTable("gusto_webhook_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventId: text("event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});
export type GustoWebhookEvent = typeof gustoWebhookEvents.$inferSelect;

// SMS Attempts — log every inbound SMS for manager review (success + rejections)
export const smsAttempts = pgTable("sms_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromPhone: text("from_phone").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull(), // ok | unknown_number | inactive_employee | parse_error | over_cap
  employeeId: varchar("employee_id").references(() => employees.id, { onDelete: "set null" }),
  employeeName: text("employee_name"),
  hoursRequested: decimal("hours_requested", { precision: 5, scale: 2 }),
  replyMessage: text("reply_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSmsAttemptSchema = createInsertSchema(smsAttempts).omit({ id: true, createdAt: true });
export type InsertSmsAttempt = z.infer<typeof insertSmsAttemptSchema>;
export type SmsAttempt = typeof smsAttempts.$inferSelect;

function validateLineItemAmount(
  data: { quantity?: string; rate?: string; amount?: string },
  ctx: z.RefinementCtx,
) {
  if (data.quantity !== undefined && data.rate !== undefined && data.amount !== undefined) {
    const qty = parseFloat(data.quantity);
    const rate = parseFloat(data.rate);
    const amount = parseFloat(data.amount);
    if (!isNaN(qty) && !isNaN(rate) && !isNaN(amount)) {
      const expected = qty * rate;
      if (Math.abs(amount - expected) > 0.001) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Amount must equal quantity × rate (expected ${expected.toFixed(2)}, got ${amount.toFixed(2)})`,
          path: ["amount"],
        });
      }
    }
  }
}
