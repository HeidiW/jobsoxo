import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table for authentication
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  companyName: text("company_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

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

export const insertLineItemSchema = createInsertSchema(lineItems).omit({ id: true });
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
}));

export const insertInvoiceSchema = createInsertSchema(invoices)
  .omit({ id: true, createdAt: true })
  .extend({
    issueDate: z.coerce.date().optional(),
    dueDate: z.coerce.date(),
    lastReminderSent: z.coerce.date().optional().nullable(),
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
  });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof payments.$inferSelect;

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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const employeesRelations = relations(employees, ({ many }) => ({
  assignments: many(employeeAssignments),
  timeEntries: many(timeEntries),
  payrollRecords: many(payrollRecords),
}));

export const insertEmployeeSchema = createInsertSchema(employees)
  .omit({ id: true, createdAt: true })
  .extend({
    hireDate: z.coerce.date().optional().nullable(),
  });
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employees.$inferSelect;

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
  hourlyRate: decimal("hourly_rate", { precision: 10, scale: 2 }).notNull(),
  grossPay: decimal("gross_pay", { precision: 10, scale: 2 }).notNull(),
  deductions: decimal("deductions", { precision: 10, scale: 2 }).default("0"),
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

export const insertPayrollRecordSchema = createInsertSchema(payrollRecords).omit({ id: true, createdAt: true });
export type InsertPayrollRecord = z.infer<typeof insertPayrollRecordSchema>;
export type PayrollRecord = typeof payrollRecords.$inferSelect;

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
});

export const insertSettingsSchema = createInsertSchema(settings).omit({ id: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settings.$inferSelect;
