import { encrypt, decrypt } from "./encryption";
import {
  type User,
  type InsertUser,
  type Client,
  type InsertClient,
  type Job,
  type InsertJob,
  type JobMaterial,
  type InsertJobMaterial,
  type LineItem,
  type InsertLineItem,
  type Invoice,
  type InsertInvoice,
  type Payment,
  type InsertPayment,
  type Employee,
  type InsertEmployee,
  type EmployeeAssignment,
  type InsertEmployeeAssignment,
  type TimeEntry,
  type InsertTimeEntry,
  type PayrollRecord,
  type InsertPayrollRecord,
  type EmployeeDeduction,
  type InsertEmployeeDeduction,
  type PayrollSettings,
  type InsertPayrollSettings,
  type Settings,
  type InsertSettings,
  type Invite,
  type InboxTask,
  type InsertInboxTask,
  type GoogleToken,
  type GoogleDocsToken,
  type JobDocument,
  type InsertJobDocument,
  type ChangeOrder,
  type InsertChangeOrder,
  type OnboardingItem,
  type InsertOnboardingItem,
  type SmsAttempt,
  type InsertSmsAttempt,
  type ReminderLog,
  type InsertReminderLog,
  type BankAccount,
  type InsertBankAccount,
  type StoredPlaidTransaction,
  type InsertPlaidTransaction,
  users,
  clients,
  jobs,
  jobMaterials,
  lineItems,
  invoices,
  payments,
  employees,
  employeeAssignments,
  timeEntries,
  payrollRecords,
  employeeDeductions,
  payrollSettings,
  settings,
  invites,
  inboxTasks,
  googleTokens,
  googleDocsTokens,
  jobDocuments,
  changeOrders,
  onboardingItems,
  smsAttempts,
  reminderLogs,
  bankAccounts,
  plaidTransactions,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lte, sql, isNull, or, inArray } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByUsernameOrEmail(identifier: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  setResetToken(userId: string, token: string, expiry: Date): Promise<void>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  clearResetToken(userId: string): Promise<void>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;
  updateUserDisplayName(userId: string, displayName: string): Promise<User>;

  // Clients
  getClients(): Promise<Client[]>;
  getClient(id: string): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  updateClient(id: string, client: Partial<InsertClient>): Promise<Client | undefined>;
  deleteClient(id: string): Promise<void>;
  getClientStats(clientId: string): Promise<{ activeJobs: number; outstandingBalance: number }>;

  // Jobs
  getJobs(): Promise<Job[]>;
  getJob(id: string): Promise<Job | undefined>;
  getJobsByClient(clientId: string): Promise<Job[]>;
  createJob(job: InsertJob): Promise<Job>;
  updateJob(id: string, job: Partial<InsertJob>): Promise<Job | undefined>;
  deleteJob(id: string): Promise<void>;

  // Job Materials
  getJobMaterials(jobId?: string): Promise<JobMaterial[]>;
  getJobMaterialTotal(jobId: string): Promise<string>;
  getJobMaterial(id: string): Promise<JobMaterial | undefined>;
  createJobMaterial(material: InsertJobMaterial): Promise<JobMaterial>;
  updateJobMaterial(id: string, material: Partial<InsertJobMaterial>): Promise<JobMaterial | undefined>;
  deleteJobMaterial(id: string): Promise<void>;

  // Line Items
  getLineItems(jobId: string): Promise<LineItem[]>;
  getLineItem(id: string): Promise<LineItem | undefined>;
  createLineItem(lineItem: InsertLineItem): Promise<LineItem>;
  updateLineItem(id: string, lineItem: Partial<InsertLineItem>): Promise<LineItem | undefined>;
  deleteLineItem(id: string): Promise<void>;

  // Invoices
  getInvoices(): Promise<Invoice[]>;
  getInvoice(id: string): Promise<Invoice | undefined>;
  getInvoicesByClient(clientId: string): Promise<Invoice[]>;
  createInvoice(invoice: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: string, invoice: Partial<InsertInvoice>): Promise<Invoice | undefined>;
  deleteInvoice(id: string): Promise<void>;
  getNextInvoiceNumber(): Promise<string>;

  // Payments
  getPaymentsByInvoice(invoiceId: string): Promise<Payment[]>;
  createPayment(payment: InsertPayment): Promise<Payment>;

  // Employees
  getEmployees(): Promise<Employee[]>;
  getEmployee(id: string): Promise<Employee | undefined>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;
  updateEmployee(id: string, employee: Partial<InsertEmployee>): Promise<Employee | undefined>;
  deleteEmployee(id: string): Promise<void>;
  setEmployeeDirectDepositToken(employeeId: string, token: string, expiry: Date, linkUserId: string): Promise<void>;
  getEmployeeByDirectDepositToken(token: string): Promise<Employee | undefined>;
  clearEmployeeDirectDepositToken(employeeId: string): Promise<void>;

  // Employee Assignments
  getAssignmentsByJob(jobId: string): Promise<EmployeeAssignment[]>;
  getJobsByEmployee(employeeId: string): Promise<Job[]>;
  setJobAssignments(jobId: string, employeeIds: string[]): Promise<void>;

  // Time Entries
  getTimeEntries(): Promise<TimeEntry[]>;
  getTimeEntriesByEmployee(employeeId: string): Promise<TimeEntry[]>;
  getTimeEntriesByPeriod(start: Date, end: Date): Promise<TimeEntry[]>;
  createTimeEntry(timeEntry: InsertTimeEntry): Promise<TimeEntry>;
  deleteTimeEntry(id: string): Promise<void>;

  // Payroll Records
  getPayrollRecords(): Promise<PayrollRecord[]>;
  getPayrollRecordsByEmployee(employeeId: string): Promise<PayrollRecord[]>;
  createPayrollRecord(record: InsertPayrollRecord): Promise<PayrollRecord>;
  updatePayrollRecord(id: string, updates: Partial<InsertPayrollRecord>): Promise<PayrollRecord | undefined>;

  // Employee Deductions
  getDeductionsByEmployee(employeeId: string): Promise<EmployeeDeduction[]>;
  createDeduction(deduction: InsertEmployeeDeduction): Promise<EmployeeDeduction>;
  updateDeduction(id: string, updates: Partial<InsertEmployeeDeduction>): Promise<EmployeeDeduction | undefined>;
  deleteDeduction(id: string): Promise<void>;

  // Payroll Settings
  getPayrollSettings(): Promise<PayrollSettings | undefined>;
  upsertPayrollSettings(data: Partial<InsertPayrollSettings>): Promise<PayrollSettings>;

  // Settings
  getSettings(): Promise<Settings | undefined>;
  updateSettings(settings: Partial<InsertSettings>): Promise<Settings>;
  setLastInboxSync(date: Date): Promise<void>;

  // Invites
  getInvites(): Promise<Invite[]>;
  getInviteByCode(code: string): Promise<Invite | undefined>;
  createInvite(code: string, label?: string): Promise<Invite>;
  markInviteUsed(code: string, userId: string): Promise<void>;
  deleteInvite(id: string): Promise<void>;

  // Google Tokens — per-user Gmail OAuth
  getGoogleToken(userId: string): Promise<GoogleToken | undefined>;
  saveGoogleToken(userId: string, data: { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null; gmailEmail?: string | null }): Promise<GoogleToken>;
  deleteGoogleToken(userId: string): Promise<void>;
  getUsersWithGmailTokens(): Promise<User[]>;
  getSyncLabels(userId: string): Promise<string[]>;
  saveSyncLabels(userId: string, labels: string[]): Promise<void>;

  // Google Docs — separate per-user read-only OAuth connection
  getGoogleDocsToken(userId: string): Promise<GoogleDocsToken | undefined>;
  saveGoogleDocsToken(userId: string, data: { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null; googleEmail?: string | null }): Promise<GoogleDocsToken>;
  deleteGoogleDocsToken(userId: string): Promise<void>;

  // Inbox Tasks — per-user (each user's own Gmail connection)
  getUsersWithInboxTasks(): Promise<User[]>;
  getInboxTasks(userId: string): Promise<InboxTask[]>;
  getHiddenInboxTasks(userId: string): Promise<InboxTask[]>;
  upsertInboxTask(task: InsertInboxTask): Promise<InboxTask>;
  markInboxTaskDone(userId: string, emailId: string, isDone: boolean): Promise<InboxTask | undefined>;
  dismissInboxTask(userId: string, emailId: string): Promise<InboxTask | undefined>;
  snoozeInboxTask(userId: string, emailId: string, until: Date): Promise<InboxTask | undefined>;
  restoreInboxTask(userId: string, emailId: string): Promise<InboxTask | undefined>;
  deleteInboxTask(userId: string, emailId: string): Promise<void>;
  deleteAllDismissedInboxTasks(userId: string): Promise<void>;
  deleteManyInboxTasks(userId: string, emailIds: string[]): Promise<void>;
  deleteUserInboxTasks(userId: string): Promise<void>;
  deleteAllInboxTasks(): Promise<void>;

  // Change Orders
  getAllChangeOrders(): Promise<(ChangeOrder & { invoice: Invoice | null; job: Job | null; client: Client | null })[]>;
  getChangeOrdersByInvoice(invoiceId: string): Promise<ChangeOrder[]>;
  getChangeOrder(id: string): Promise<ChangeOrder | undefined>;
  createChangeOrder(order: InsertChangeOrder): Promise<ChangeOrder>;
  updateChangeOrder(id: string, updates: Partial<InsertChangeOrder>): Promise<ChangeOrder | undefined>;
  deleteChangeOrder(id: string): Promise<void>;

  // Onboarding Items
  getOnboardingItems(employeeId: string): Promise<OnboardingItem[]>;
  upsertOnboardingItem(item: InsertOnboardingItem): Promise<OnboardingItem>;
  updateOnboardingItem(id: string, employeeId: string, updates: Partial<InsertOnboardingItem>): Promise<OnboardingItem | undefined>;
  deleteOnboardingItem(id: string, employeeId: string): Promise<void>;
  seedDefaultOnboardingItems(employeeId: string): Promise<void>;

  // Job Documents
  getJobDocuments(jobId: string): Promise<JobDocument[]>;
  getJobDocument(id: string): Promise<JobDocument | undefined>;
  createJobDocument(doc: InsertJobDocument): Promise<JobDocument>;
  deleteJobDocument(id: string): Promise<void>;

  // SMS Attempts
  getSmsAttempts(): Promise<SmsAttempt[]>;
  createSmsAttempt(attempt: InsertSmsAttempt): Promise<SmsAttempt>;

  // Reminder Logs
  getReminderLogsByInvoice(invoiceId: string): Promise<ReminderLog[]>;
  insertReminderLog(log: InsertReminderLog): Promise<ReminderLog>;

  // Bank Accounts (Plaid)
  getBankAccountByEntity(userId: string, entityType: string, entityId?: string): Promise<BankAccount | undefined>;
  getBankAccountById(id: string): Promise<BankAccount | undefined>;
  createBankAccount(account: InsertBankAccount): Promise<BankAccount>;
  deleteBankAccount(id: string): Promise<void>;
  getBusinessBankAccount(userId: string): Promise<BankAccount | undefined>;

  // Plaid Transactions
  upsertPlaidTransactions(transactions: InsertPlaidTransaction[]): Promise<StoredPlaidTransaction[]>;
  getPlaidTransactions(userId: string, limit?: number): Promise<StoredPlaidTransaction[]>;
  matchPlaidTransaction(plaidTxId: string, paymentId: string): Promise<void>;
  markAllPayrollPeriodPaid(periodStart: Date, periodEnd: Date): Promise<number>;

  // Dashboard
  getDashboardStats(): Promise<{
    outstandingAmount: number;
    monthRevenue: number;
    activeJobs: number;
    overdueInvoices: number;
  }>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async getUserByUsernameOrEmail(identifier: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(
      or(eq(users.username, identifier), eq(users.email, identifier))
    );
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async setResetToken(userId: string, token: string, expiry: Date): Promise<void> {
    await db.update(users).set({ resetToken: token, resetTokenExpiry: expiry }).where(eq(users.id, userId));
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.resetToken, token));
    return user || undefined;
  }

  async clearResetToken(userId: string): Promise<void> {
    await db.update(users).set({ resetToken: null, resetTokenExpiry: null }).where(eq(users.id, userId));
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await db.update(users).set({ password: passwordHash }).where(eq(users.id, userId));
  }

  async updateUserDisplayName(userId: string, displayName: string): Promise<User> {
    const [updated] = await db.update(users).set({ displayName }).where(eq(users.id, userId)).returning();
    return updated;
  }

  // Clients
  async getClients(): Promise<Client[]> {
    return db.select().from(clients).orderBy(desc(clients.createdAt));
  }

  async getClient(id: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client || undefined;
  }

  async createClient(client: InsertClient): Promise<Client> {
    const [newClient] = await db.insert(clients).values(client).returning();
    return newClient;
  }

  async updateClient(id: string, client: Partial<InsertClient>): Promise<Client | undefined> {
    const [updated] = await db.update(clients).set(client).where(eq(clients.id, id)).returning();
    return updated || undefined;
  }

  async deleteClient(id: string): Promise<void> {
    await db.delete(clients).where(eq(clients.id, id));
  }

  async getClientStats(clientId: string): Promise<{ activeJobs: number; outstandingBalance: number }> {
    const activeJobsResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(jobs)
      .where(and(eq(jobs.clientId, clientId), sql`${jobs.status} != 'completed'`));

    const balanceResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${invoices.balance}::numeric), 0)` })
      .from(invoices)
      .where(and(eq(invoices.clientId, clientId), sql`${invoices.status} != 'paid'`));

    return {
      activeJobs: Number(activeJobsResult[0]?.count) || 0,
      outstandingBalance: Number(balanceResult[0]?.total) || 0,
    };
  }

  // Jobs
  async getJobs(): Promise<Job[]> {
    return db.select().from(jobs).orderBy(desc(jobs.createdAt));
  }

  async getJob(id: string): Promise<Job | undefined> {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    return job || undefined;
  }

  async getJobsByClient(clientId: string): Promise<Job[]> {
    return db.select().from(jobs).where(eq(jobs.clientId, clientId)).orderBy(desc(jobs.createdAt));
  }

  async createJob(job: InsertJob): Promise<Job> {
    const [newJob] = await db.insert(jobs).values(job).returning();
    return newJob;
  }

  async updateJob(id: string, job: Partial<InsertJob>): Promise<Job | undefined> {
    const [updated] = await db.update(jobs).set(job).where(eq(jobs.id, id)).returning();
    return updated || undefined;
  }

  async deleteJob(id: string): Promise<void> {
    await db.delete(jobs).where(eq(jobs.id, id));
  }

  // Job Materials
  async getJobMaterials(jobId?: string): Promise<JobMaterial[]> {
    const query = db.select().from(jobMaterials);
    if (jobId) {
      return query.where(eq(jobMaterials.jobId, jobId)).orderBy(desc(jobMaterials.purchaseDate));
    }
    return query.orderBy(desc(jobMaterials.purchaseDate));
  }

  async getJobMaterialTotal(jobId: string): Promise<string> {
    const [result] = await db
      .select({ total: sql<string>`COALESCE(SUM(${jobMaterials.price}), 0)` })
      .from(jobMaterials)
      .where(eq(jobMaterials.jobId, jobId));
    return result?.total ?? "0";
  }

  async getJobMaterial(id: string): Promise<JobMaterial | undefined> {
    const [material] = await db.select().from(jobMaterials).where(eq(jobMaterials.id, id));
    return material || undefined;
  }

  async createJobMaterial(material: InsertJobMaterial): Promise<JobMaterial> {
    const [created] = await db.insert(jobMaterials).values(material).returning();
    return created;
  }

  async updateJobMaterial(id: string, material: Partial<InsertJobMaterial>): Promise<JobMaterial | undefined> {
    const [updated] = await db.update(jobMaterials).set(material).where(eq(jobMaterials.id, id)).returning();
    return updated || undefined;
  }

  async deleteJobMaterial(id: string): Promise<void> {
    await db.delete(jobMaterials).where(eq(jobMaterials.id, id));
  }

  // Line Items
  async getLineItems(jobId: string): Promise<LineItem[]> {
    return db.select().from(lineItems).where(eq(lineItems.jobId, jobId));
  }

  async getLineItem(id: string): Promise<LineItem | undefined> {
    const [item] = await db.select().from(lineItems).where(eq(lineItems.id, id));
    return item || undefined;
  }

  async createLineItem(lineItem: InsertLineItem): Promise<LineItem> {
    const [newItem] = await db.insert(lineItems).values(lineItem).returning();
    return newItem;
  }

  async updateLineItem(id: string, lineItem: Partial<InsertLineItem>): Promise<LineItem | undefined> {
    const [updated] = await db.update(lineItems).set(lineItem).where(eq(lineItems.id, id)).returning();
    return updated || undefined;
  }

  async deleteLineItem(id: string): Promise<void> {
    await db.delete(lineItems).where(eq(lineItems.id, id));
  }

  // Invoices
  async getInvoices(): Promise<Invoice[]> {
    return db.select().from(invoices).orderBy(desc(invoices.createdAt));
  }

  async getInvoice(id: string): Promise<Invoice | undefined> {
    const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
    return invoice || undefined;
  }

  async getInvoicesByClient(clientId: string): Promise<Invoice[]> {
    return db.select().from(invoices).where(eq(invoices.clientId, clientId)).orderBy(desc(invoices.createdAt));
  }

  async createInvoice(invoice: InsertInvoice): Promise<Invoice> {
    const [newInvoice] = await db.insert(invoices).values(invoice).returning();
    return newInvoice;
  }

  async updateInvoice(id: string, invoice: Partial<InsertInvoice>): Promise<Invoice | undefined> {
    const [updated] = await db.update(invoices).set(invoice).where(eq(invoices.id, id)).returning();
    return updated || undefined;
  }

  async deleteInvoice(id: string): Promise<void> {
    await db.delete(invoices).where(eq(invoices.id, id));
  }

  async getNextInvoiceNumber(): Promise<string> {
    const settingsResult = await this.getSettings();
    const prefix = settingsResult?.invoicePrefix || "INV";
    
    const [lastInvoice] = await db
      .select({ invoiceNumber: invoices.invoiceNumber })
      .from(invoices)
      .orderBy(desc(invoices.createdAt))
      .limit(1);

    let nextNumber = 1;
    if (lastInvoice?.invoiceNumber) {
      const match = lastInvoice.invoiceNumber.match(/(\d+)$/);
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1;
      }
    }

    return `${prefix}-${String(nextNumber).padStart(4, "0")}`;
  }

  // Payments
  async getPaymentsByInvoice(invoiceId: string): Promise<Payment[]> {
    return db.select().from(payments).where(eq(payments.invoiceId, invoiceId)).orderBy(desc(payments.paymentDate));
  }

  async createPayment(payment: InsertPayment): Promise<Payment> {
    const [newPayment] = await db.insert(payments).values(payment).returning();
    return newPayment;
  }

  // Employees
  async getEmployees(): Promise<Employee[]> {
    return db.select().from(employees).orderBy(desc(employees.createdAt));
  }

  async getEmployee(id: string): Promise<Employee | undefined> {
    const [employee] = await db.select().from(employees).where(eq(employees.id, id));
    return employee || undefined;
  }

  async createEmployee(employee: InsertEmployee): Promise<Employee> {
    const [newEmployee] = await db.insert(employees).values(employee).returning();
    return newEmployee;
  }

  async updateEmployee(id: string, employee: Partial<InsertEmployee>): Promise<Employee | undefined> {
    const [updated] = await db.update(employees).set(employee).where(eq(employees.id, id)).returning();
    return updated || undefined;
  }

  async deleteEmployee(id: string): Promise<void> {
    await db.delete(employees).where(eq(employees.id, id));
  }

  async setEmployeeDirectDepositToken(employeeId: string, token: string, expiry: Date, linkUserId: string): Promise<void> {
    await db.update(employees).set({
      directDepositToken: token,
      directDepositTokenExpiry: expiry,
      directDepositLinkUserId: linkUserId,
    } as any).where(eq(employees.id, employeeId));
  }

  async getEmployeeByDirectDepositToken(token: string): Promise<Employee | undefined> {
    const [row] = await db.select().from(employees).where(eq((employees as any).directDepositToken, token));
    return row ?? undefined;
  }

  async clearEmployeeDirectDepositToken(employeeId: string): Promise<void> {
    await db.update(employees).set({
      directDepositToken: null,
      directDepositTokenExpiry: null,
    } as any).where(eq(employees.id, employeeId));
  }

  // Time Entries
  async getTimeEntries(): Promise<TimeEntry[]> {
    return db.select().from(timeEntries).orderBy(desc(timeEntries.date));
  }

  async getTimeEntriesByEmployee(employeeId: string): Promise<TimeEntry[]> {
    return db.select().from(timeEntries).where(eq(timeEntries.employeeId, employeeId)).orderBy(desc(timeEntries.date));
  }

  async createTimeEntry(timeEntry: InsertTimeEntry): Promise<TimeEntry> {
    const [newEntry] = await db.insert(timeEntries).values(timeEntry).returning();
    return newEntry;
  }

  async getTimeEntriesByPeriod(start: Date, end: Date): Promise<TimeEntry[]> {
    return db.select().from(timeEntries)
      .where(and(gte(timeEntries.date, start), lte(timeEntries.date, end)))
      .orderBy(desc(timeEntries.date));
  }

  async deleteTimeEntry(id: string): Promise<void> {
    await db.delete(timeEntries).where(eq(timeEntries.id, id));
  }

  // Payroll Records
  async getPayrollRecords(): Promise<PayrollRecord[]> {
    return db.select().from(payrollRecords).orderBy(desc(payrollRecords.periodStart));
  }

  async getPayrollRecordsByEmployee(employeeId: string): Promise<PayrollRecord[]> {
    return db.select().from(payrollRecords)
      .where(eq(payrollRecords.employeeId, employeeId))
      .orderBy(desc(payrollRecords.periodStart));
  }

  async createPayrollRecord(record: InsertPayrollRecord): Promise<PayrollRecord> {
    const [newRecord] = await db.insert(payrollRecords).values(record).returning();
    return newRecord;
  }

  async updatePayrollRecord(id: string, updates: Partial<InsertPayrollRecord>): Promise<PayrollRecord | undefined> {
    const [updated] = await db.update(payrollRecords).set(updates).where(eq(payrollRecords.id, id)).returning();
    return updated || undefined;
  }

  // Employee Deductions
  async getDeductionsByEmployee(employeeId: string): Promise<EmployeeDeduction[]> {
    return db.select().from(employeeDeductions).where(eq(employeeDeductions.employeeId, employeeId)).orderBy(employeeDeductions.createdAt);
  }

  async createDeduction(deduction: InsertEmployeeDeduction): Promise<EmployeeDeduction> {
    const [created] = await db.insert(employeeDeductions).values(deduction).returning();
    return created;
  }

  async updateDeduction(id: string, updates: Partial<InsertEmployeeDeduction>): Promise<EmployeeDeduction | undefined> {
    const [updated] = await db.update(employeeDeductions).set(updates).where(eq(employeeDeductions.id, id)).returning();
    return updated || undefined;
  }

  async deleteDeduction(id: string): Promise<void> {
    await db.delete(employeeDeductions).where(eq(employeeDeductions.id, id));
  }

  // Payroll Settings
  async getPayrollSettings(): Promise<PayrollSettings | undefined> {
    const [row] = await db.select().from(payrollSettings).limit(1);
    return row || undefined;
  }

  async upsertPayrollSettings(data: Partial<InsertPayrollSettings>): Promise<PayrollSettings> {
    const existing = await this.getPayrollSettings();
    if (existing) {
      const [updated] = await db.update(payrollSettings).set({ ...data, updatedAt: new Date() }).where(eq(payrollSettings.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(payrollSettings).values({ payFrequency: "biweekly", ...data } as any).returning();
    return created;
  }

  // Settings
  async getSettings(): Promise<Settings | undefined> {
    const [setting] = await db.select().from(settings).limit(1);
    return setting || undefined;
  }

  async updateSettings(settingsData: Partial<InsertSettings>): Promise<Settings> {
    const existing = await this.getSettings();
    if (existing) {
      const [updated] = await db.update(settings).set(settingsData).where(eq(settings.id, existing.id)).returning();
      return updated;
    } else {
      const [newSettings] = await db.insert(settings).values(settingsData as InsertSettings).returning();
      return newSettings;
    }
  }

  async setLastInboxSync(date: Date): Promise<void> {
    const existing = await this.getSettings();
    if (existing) {
      await db.update(settings).set({ lastInboxSync: date }).where(eq(settings.id, existing.id));
    } else {
      await db.insert(settings).values({ lastInboxSync: date } as any);
    }
  }

  // Invites
  async getInvites(): Promise<Invite[]> {
    return db.select().from(invites).orderBy(desc(invites.createdAt));
  }

  async getInviteByCode(code: string): Promise<Invite | undefined> {
    const [invite] = await db.select().from(invites).where(eq(invites.code, code));
    return invite || undefined;
  }

  async createInvite(code: string, label?: string): Promise<Invite> {
    const [invite] = await db.insert(invites).values({ code, label: label || null }).returning();
    return invite;
  }

  async markInviteUsed(code: string, userId: string): Promise<void> {
    await db.update(invites).set({ usedAt: new Date(), usedByUserId: userId }).where(eq(invites.code, code));
  }

  async deleteInvite(id: string): Promise<void> {
    await db.delete(invites).where(eq(invites.id, id));
  }

  // Employee Assignments
  async getAssignmentsByJob(jobId: string): Promise<EmployeeAssignment[]> {
    return db.select().from(employeeAssignments).where(eq(employeeAssignments.jobId, jobId));
  }

  async getJobsByEmployee(employeeId: string): Promise<Job[]> {
    const assignments = await db
      .select()
      .from(employeeAssignments)
      .where(eq(employeeAssignments.employeeId, employeeId));
    if (assignments.length === 0) return [];
    const jobIds = assignments.map((a) => a.jobId);
    return db.select().from(jobs).where(inArray(jobs.id, jobIds));
  }

  async setJobAssignments(jobId: string, employeeIds: string[]): Promise<void> {
    await db.delete(employeeAssignments).where(eq(employeeAssignments.jobId, jobId));
    if (employeeIds.length > 0) {
      await db.insert(employeeAssignments).values(
        employeeIds.map((employeeId) => ({ employeeId, jobId }))
      );
    }
  }

  // Inbox Tasks — per-user
  async getUsersWithInboxTasks(): Promise<User[]> {
    const rows = await db
      .selectDistinct({ userId: inboxTasks.userId })
      .from(inboxTasks);
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.userId);
    return db.select().from(users).where(sql`${users.id} = ANY(${ids})`);
  }

  async getInboxTasks(userId: string): Promise<InboxTask[]> {
    const now = new Date();
    return db
      .select()
      .from(inboxTasks)
      .where(
        and(
          eq(inboxTasks.userId, userId),
          eq(inboxTasks.dismissed, false),
          eq(inboxTasks.permanentlyDeleted, false),
          or(isNull(inboxTasks.snoozedUntil), lte(inboxTasks.snoozedUntil, now))
        )
      )
      .orderBy(desc(inboxTasks.receivedAt));
  }

  async upsertInboxTask(task: InsertInboxTask): Promise<InboxTask> {
    const [existing] = await db
      .select()
      .from(inboxTasks)
      .where(and(eq(inboxTasks.userId, task.userId), eq(inboxTasks.emailId, task.emailId)));

    if (existing) {
      // If permanently deleted, leave the tombstone intact — never re-insert
      if (existing.permanentlyDeleted) return existing;
      // Preserve isDone — only update Gmail metadata
      const [updated] = await db
        .update(inboxTasks)
        .set({
          subject: task.subject,
          sender: task.sender,
          senderEmail: task.senderEmail,
          snippet: task.snippet,
          receivedAt: task.receivedAt,
          isRead: task.isRead,
        })
        .where(eq(inboxTasks.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(inboxTasks).values(task).returning();
    return created;
  }

  async markInboxTaskDone(userId: string, emailId: string, isDone: boolean): Promise<InboxTask | undefined> {
    const [updated] = await db
      .update(inboxTasks)
      .set({ isDone })
      .where(and(eq(inboxTasks.userId, userId), eq(inboxTasks.emailId, emailId)))
      .returning();
    return updated ?? undefined;
  }

  async dismissInboxTask(userId: string, emailId: string): Promise<InboxTask | undefined> {
    const [updated] = await db
      .update(inboxTasks)
      .set({ dismissed: true })
      .where(and(eq(inboxTasks.userId, userId), eq(inboxTasks.emailId, emailId)))
      .returning();
    return updated ?? undefined;
  }

  async snoozeInboxTask(userId: string, emailId: string, until: Date): Promise<InboxTask | undefined> {
    const [updated] = await db
      .update(inboxTasks)
      .set({ snoozedUntil: until })
      .where(and(eq(inboxTasks.userId, userId), eq(inboxTasks.emailId, emailId)))
      .returning();
    return updated ?? undefined;
  }

  async getHiddenInboxTasks(userId: string): Promise<InboxTask[]> {
    const now = new Date();
    return db
      .select()
      .from(inboxTasks)
      .where(
        and(
          eq(inboxTasks.userId, userId),
          eq(inboxTasks.permanentlyDeleted, false),
          or(
            eq(inboxTasks.dismissed, true),
            sql`${inboxTasks.snoozedUntil} IS NOT NULL AND ${inboxTasks.snoozedUntil} > ${now}`
          )
        )
      )
      .orderBy(desc(inboxTasks.receivedAt));
  }

  async restoreInboxTask(userId: string, emailId: string): Promise<InboxTask | undefined> {
    const [updated] = await db
      .update(inboxTasks)
      .set({ dismissed: false, snoozedUntil: null })
      .where(and(eq(inboxTasks.userId, userId), eq(inboxTasks.emailId, emailId)))
      .returning();
    return updated ?? undefined;
  }

  async deleteInboxTask(userId: string, emailId: string): Promise<void> {
    await db
      .update(inboxTasks)
      .set({ permanentlyDeleted: true })
      .where(and(eq(inboxTasks.userId, userId), eq(inboxTasks.emailId, emailId)));
  }

  async deleteAllDismissedInboxTasks(userId: string): Promise<void> {
    await db
      .update(inboxTasks)
      .set({ permanentlyDeleted: true })
      .where(and(eq(inboxTasks.userId, userId), eq(inboxTasks.dismissed, true)));
  }

  async deleteManyInboxTasks(userId: string, emailIds: string[]): Promise<void> {
    if (emailIds.length === 0) return;
    await db
      .update(inboxTasks)
      .set({ permanentlyDeleted: true })
      .where(and(eq(inboxTasks.userId, userId), inArray(inboxTasks.emailId, emailIds)));
  }

  async deleteUserInboxTasks(userId: string): Promise<void> {
    await db.delete(inboxTasks).where(eq(inboxTasks.userId, userId));
  }

  async deleteAllInboxTasks(): Promise<void> {
    await db.delete(inboxTasks);
  }

  // Google Tokens — per-user Gmail OAuth
  async getGoogleToken(userId: string): Promise<GoogleToken | undefined> {
    const [token] = await db.select().from(googleTokens).where(eq(googleTokens.userId, userId));
    return token ?? undefined;
  }

  async saveGoogleToken(userId: string, data: { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null; gmailEmail?: string | null }): Promise<GoogleToken> {
    const existing = await this.getGoogleToken(userId);
    if (existing) {
      const [updated] = await db
        .update(googleTokens)
        .set({
          accessToken: data.accessToken,
          ...(data.refreshToken !== undefined ? { refreshToken: data.refreshToken } : {}),
          ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
          ...(data.gmailEmail !== undefined ? { gmailEmail: data.gmailEmail } : {}),
        })
        .where(eq(googleTokens.userId, userId))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(googleTokens)
      .values({
        userId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? null,
        expiresAt: data.expiresAt ?? null,
        gmailEmail: data.gmailEmail ?? null,
      })
      .returning();
    return created;
  }

  async deleteGoogleToken(userId: string): Promise<void> {
    await db.delete(googleTokens).where(eq(googleTokens.userId, userId));
  }

  // Google Docs — separate per-user read-only OAuth connection
  async getGoogleDocsToken(userId: string): Promise<GoogleDocsToken | undefined> {
    const [token] = await db.select().from(googleDocsTokens).where(eq(googleDocsTokens.userId, userId));
    return token ?? undefined;
  }

  async saveGoogleDocsToken(userId: string, data: { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null; googleEmail?: string | null }): Promise<GoogleDocsToken> {
    const existing = await this.getGoogleDocsToken(userId);
    if (existing) {
      const [updated] = await db
        .update(googleDocsTokens)
        .set({
          accessToken: data.accessToken,
          ...(data.refreshToken !== undefined ? { refreshToken: data.refreshToken } : {}),
          ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
          ...(data.googleEmail !== undefined ? { googleEmail: data.googleEmail } : {}),
        })
        .where(eq(googleDocsTokens.userId, userId))
        .returning();
      return updated;
    }
    const [created] = await db
      .insert(googleDocsTokens)
      .values({
        userId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? null,
        expiresAt: data.expiresAt ?? null,
        googleEmail: data.googleEmail ?? null,
      })
      .returning();
    return created;
  }

  async deleteGoogleDocsToken(userId: string): Promise<void> {
    await db.delete(googleDocsTokens).where(eq(googleDocsTokens.userId, userId));
  }

  async getUsersWithGmailTokens(): Promise<User[]> {
    const rows = await db
      .select({ user: users })
      .from(googleTokens)
      .innerJoin(users, eq(googleTokens.userId, users.id));
    return rows.map((r) => r.user);
  }

  async getSyncLabels(userId: string): Promise<string[]> {
    const token = await this.getGoogleToken(userId);
    const labels = token?.syncLabels;
    return Array.isArray(labels) && labels.length > 0 ? labels : ["INBOX"];
  }

  async saveSyncLabels(userId: string, labels: string[]): Promise<void> {
    await db
      .update(googleTokens)
      .set({ syncLabels: labels })
      .where(eq(googleTokens.userId, userId));
  }

  // Onboarding Items
  async getOnboardingItems(employeeId: string): Promise<OnboardingItem[]> {
    return db.select().from(onboardingItems)
      .where(eq(onboardingItems.employeeId, employeeId))
      .orderBy(onboardingItems.sortOrder, onboardingItems.id);
  }

  async upsertOnboardingItem(item: InsertOnboardingItem): Promise<OnboardingItem> {
    const [created] = await db.insert(onboardingItems).values(item).returning();
    return created;
  }

  async updateOnboardingItem(id: string, employeeId: string, updates: Partial<InsertOnboardingItem>): Promise<OnboardingItem | undefined> {
    const [updated] = await db.update(onboardingItems).set(updates)
      .where(and(eq(onboardingItems.id, id), eq(onboardingItems.employeeId, employeeId)))
      .returning();
    return updated ?? undefined;
  }

  async deleteOnboardingItem(id: string, employeeId: string): Promise<void> {
    await db.delete(onboardingItems)
      .where(and(eq(onboardingItems.id, id), eq(onboardingItems.employeeId, employeeId)));
  }

  async seedDefaultOnboardingItems(employeeId: string): Promise<void> {
    const { DEFAULT_ONBOARDING_ITEMS } = await import("@shared/schema");
    await db.insert(onboardingItems).values(
      DEFAULT_ONBOARDING_ITEMS.map((label, i) => ({
        employeeId,
        label,
        completed: false,
        completedDate: null,
        sortOrder: i,
      }))
    );
  }

  // Job Documents
  async getJobDocuments(jobId: string): Promise<JobDocument[]> {
    return db.select().from(jobDocuments).where(eq(jobDocuments.jobId, jobId)).orderBy(desc(jobDocuments.uploadedAt));
  }

  async getJobDocument(id: string): Promise<JobDocument | undefined> {
    const [doc] = await db.select().from(jobDocuments).where(eq(jobDocuments.id, id));
    return doc ?? undefined;
  }

  async createJobDocument(doc: InsertJobDocument): Promise<JobDocument> {
    const [newDoc] = await db.insert(jobDocuments).values(doc).returning();
    return newDoc;
  }

  async deleteJobDocument(id: string): Promise<void> {
    await db.delete(jobDocuments).where(eq(jobDocuments.id, id));
  }

  // Change Orders
  async getAllChangeOrders(): Promise<(ChangeOrder & { invoice: Invoice | null; job: Job | null; client: Client | null })[]> {
    const orders = await db.select().from(changeOrders).orderBy(desc(changeOrders.createdAt));
    return Promise.all(orders.map(async (order) => {
      const invoice = await this.getInvoice(order.invoiceId) ?? null;
      const job = invoice?.jobId ? await this.getJob(invoice.jobId) ?? null : null;
      const client = invoice ? await this.getClient(invoice.clientId) ?? null : null;
      return { ...order, invoice, job, client };
    }));
  }

  async getChangeOrdersByInvoice(invoiceId: string): Promise<ChangeOrder[]> {
    return db.select().from(changeOrders).where(eq(changeOrders.invoiceId, invoiceId)).orderBy(changeOrders.createdAt);
  }

  async getChangeOrder(id: string): Promise<ChangeOrder | undefined> {
    const [order] = await db.select().from(changeOrders).where(eq(changeOrders.id, id));
    return order || undefined;
  }

  async createChangeOrder(order: InsertChangeOrder): Promise<ChangeOrder> {
    const [created] = await db.insert(changeOrders).values(order).returning();
    return created;
  }

  async updateChangeOrder(id: string, updates: Partial<InsertChangeOrder>): Promise<ChangeOrder | undefined> {
    const [updated] = await db.update(changeOrders).set(updates).where(eq(changeOrders.id, id)).returning();
    return updated || undefined;
  }

  async deleteChangeOrder(id: string): Promise<void> {
    await db.delete(changeOrders).where(eq(changeOrders.id, id));
  }

  async getDashboardStats(): Promise<{
    outstandingAmount: number;
    monthRevenue: number;
    activeJobs: number;
    overdueInvoices: number;
  }> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const outstandingResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${invoices.balance}::numeric), 0)` })
      .from(invoices)
      .where(sql`${invoices.status} != 'paid'`);

    const monthRevenueResult = await db
      .select({ total: sql<number>`COALESCE(SUM(${payments.amount}::numeric), 0)` })
      .from(payments)
      .where(
        and(
          gte(payments.paymentDate, startOfMonth),
          lte(payments.paymentDate, endOfMonth)
        )
      );

    const activeJobsResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(jobs)
      .where(sql`${jobs.status} IN ('scheduled', 'in_progress')`);

    const overdueResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(invoices)
      .where(eq(invoices.status, "overdue"));

    return {
      outstandingAmount: Number(outstandingResult[0]?.total) || 0,
      monthRevenue: Number(monthRevenueResult[0]?.total) || 0,
      activeJobs: Number(activeJobsResult[0]?.count) || 0,
      overdueInvoices: Number(overdueResult[0]?.count) || 0,
    };
  }

  // SMS Attempts
  async getSmsAttempts(): Promise<SmsAttempt[]> {
    return db.select().from(smsAttempts).orderBy(desc(smsAttempts.createdAt));
  }

  async createSmsAttempt(attempt: InsertSmsAttempt): Promise<SmsAttempt> {
    const [row] = await db.insert(smsAttempts).values(attempt).returning();
    return row;
  }

  // Reminder Logs
  async getReminderLogsByInvoice(invoiceId: string): Promise<ReminderLog[]> {
    return db
      .select()
      .from(reminderLogs)
      .where(eq(reminderLogs.invoiceId, invoiceId))
      .orderBy(desc(reminderLogs.sentAt));
  }

  async insertReminderLog(log: InsertReminderLog): Promise<ReminderLog> {
    const [row] = await db.insert(reminderLogs).values(log).returning();
    return row;
  }

  // Bank Accounts (Plaid)

  /** Encrypt the three sensitive fields before persisting. */
  private encryptBankAccount(account: InsertBankAccount): InsertBankAccount {
    return {
      ...account,
      plaidAccessToken: encrypt(account.plaidAccessToken),
      plaidItemId: encrypt(account.plaidItemId),
      routingNumber: account.routingNumber != null ? encrypt(account.routingNumber) : account.routingNumber,
    };
  }

  /** Decrypt the three sensitive fields after reading from the database. */
  private decryptBankAccount(row: BankAccount): BankAccount {
    return {
      ...row,
      plaidAccessToken: decrypt(row.plaidAccessToken),
      plaidItemId: decrypt(row.plaidItemId),
      routingNumber: row.routingNumber != null ? decrypt(row.routingNumber) : row.routingNumber,
    };
  }

  async getBankAccountByEntity(userId: string, entityType: string, entityId?: string): Promise<BankAccount | undefined> {
    const conditions = [eq(bankAccounts.userId, userId), eq(bankAccounts.entityType, entityType)];
    if (entityId) {
      conditions.push(eq(bankAccounts.entityId, entityId));
    } else {
      conditions.push(sql`${bankAccounts.entityId} IS NULL`);
    }
    const [row] = await db.select().from(bankAccounts).where(and(...conditions)).limit(1);
    return row ? this.decryptBankAccount(row) : undefined;
  }

  async getBankAccountById(id: string): Promise<BankAccount | undefined> {
    const [row] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id));
    return row ? this.decryptBankAccount(row) : undefined;
  }

  async createBankAccount(account: InsertBankAccount): Promise<BankAccount> {
    const [row] = await db.insert(bankAccounts).values(this.encryptBankAccount(account)).returning();
    return this.decryptBankAccount(row);
  }

  async deleteBankAccount(id: string): Promise<void> {
    await db.delete(bankAccounts).where(eq(bankAccounts.id, id));
  }

  async getBusinessBankAccount(userId: string): Promise<BankAccount | undefined> {
    return this.getBankAccountByEntity(userId, "business");
  }

  async getEmployeeBankAccounts(userId: string): Promise<BankAccount[]> {
    const rows = await db.select().from(bankAccounts)
      .where(and(eq(bankAccounts.userId, userId), eq(bankAccounts.entityType, "employee")));
    return rows.map((r) => this.decryptBankAccount(r));
  }

  async getBankAccountByEntityPublic(entityType: string, entityId: string): Promise<BankAccount | undefined> {
    const [row] = await db.select().from(bankAccounts)
      .where(and(eq(bankAccounts.entityType, entityType), eq(bankAccounts.entityId, entityId)))
      .limit(1);
    return row ? this.decryptBankAccount(row) : undefined;
  }

  // Plaid Transactions

  async upsertPlaidTransactions(transactions: InsertPlaidTransaction[]): Promise<StoredPlaidTransaction[]> {
    if (!transactions.length) return [];
    const results: StoredPlaidTransaction[] = [];
    for (const t of transactions) {
      const [row] = await db.insert(plaidTransactions)
        .values(t)
        .onConflictDoUpdate({
          target: plaidTransactions.plaidTransactionId,
          set: {
            amount: t.amount,
            name: t.name,
            merchantName: t.merchantName ?? null,
            pending: t.pending ?? false,
            syncedAt: new Date(),
          },
        })
        .returning();
      results.push(row);
    }
    return results;
  }

  async getPlaidTransactions(userId: string, limit = 50): Promise<StoredPlaidTransaction[]> {
    return db.select().from(plaidTransactions)
      .where(eq(plaidTransactions.userId, userId))
      .orderBy(desc(plaidTransactions.date))
      .limit(limit);
  }

  async matchPlaidTransaction(plaidTxId: string, paymentId: string): Promise<void> {
    await db.update(plaidTransactions)
      .set({ matchedPaymentId: paymentId })
      .where(eq(plaidTransactions.plaidTransactionId, plaidTxId));
  }

  async markAllPayrollPeriodPaid(periodStart: Date, periodEnd: Date): Promise<number> {
    // Match records whose period falls exactly on the given dates (±1 day tolerance for timezone skew)
    const startLo = new Date(periodStart); startLo.setDate(startLo.getDate() - 1);
    const startHi = new Date(periodStart); startHi.setDate(startHi.getDate() + 1);
    const endLo   = new Date(periodEnd);   endLo.setDate(endLo.getDate() - 1);
    const endHi   = new Date(periodEnd);   endHi.setDate(endHi.getDate() + 1);
    const updated = await db.update(payrollRecords)
      .set({ status: "paid", paidDate: new Date() })
      .where(
        and(
          eq(payrollRecords.status, "pending"),
          gte(payrollRecords.periodStart, startLo),
          lte(payrollRecords.periodStart, startHi),
          gte(payrollRecords.periodEnd,   endLo),
          lte(payrollRecords.periodEnd,   endHi),
        )
      )
      .returning();
    return updated.length;
  }
}

export const storage = new DatabaseStorage();
