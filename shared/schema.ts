import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

function numericString(label: string) {
  return z
    .string()
    .min(1, `${label} is required`)
    .refine(
      (val) => !isNaN(parseFloat(val)) && isFinite(Number(val)),
      `${label} must be a valid number`
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

// Users table for authentication
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  companyName: text("company_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
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

export const insertClientSchema = createInsertSchema(clients).omit({ id: true, createdAt: true });
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

export const insertLineItemSchema = createInsertSchema(lineItems)
  .omit({ id: true })
  .extend({
    quantity: positiveNumericString("Quantity"),
    rate: positiveNumericString("Rate"),
    amount: positiveNumericString("Amount"),
  })
  .superRefine((data, ctx) => {
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
  });
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
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }).notNull(),
  position: text("position"),
  hireDate: timestamp("hire_date"),
  status: text("status").notNull().default("active"), // active, inactive
  // Payroll / tax fields
  employmentType: text("employment_type").default("w2"), // w2, 1099
  payType: text("pay_type").default("hourly"), // hourly, salary
  annualSalary: decimal("annual_salary", { precision: 10, scale: 2 }),
  filingStatus: text("filing_status").default("single"), // single, married, head_of_household
  taxAllowances: integer("tax_allowances").default(0),
  stateCode: text("state_code").default("CA"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const employeesRelations = relations(employees, ({ many }) => ({
  assignments: many(employeeAssignments),
  timeEntries: many(timeEntries),
  payrollRecords: many(payrollRecords),
  deductions: many(employeeDeductions),
}));

export const insertEmployeeSchema = createInsertSchema(employees)
  .omit({ id: true, createdAt: true })
  .extend({
    hireDate: z.coerce.date().optional().nullable(),
    hourlyRate: positiveNumericString("Hourly rate"),
    employmentType: z.enum(["w2", "1099"]).optional(),
    payType: z.enum(["hourly", "salary"]).optional(),
    annualSalary: z.coerce.string().optional().nullable(),
    filingStatus: z.enum(["single", "married", "head_of_household"]).optional(),
    taxAllowances: z.coerce.number().int().min(0).max(20).optional(),
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
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }).notNull(),
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
    hourlyRate: positiveNumericString("Hourly rate"),
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
});

export const insertSettingsSchema = createInsertSchema(settings)
  .omit({ id: true })
  .extend({
    taxRate: z.coerce.string().optional(),
    inboxSyncHour: z.number().int().min(0).max(23).optional().nullable(),
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
