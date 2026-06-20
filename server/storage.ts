import {
  type User,
  type InsertUser,
  type Client,
  type InsertClient,
  type Job,
  type InsertJob,
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
  type Settings,
  type InsertSettings,
  type Invite,
  type InboxTask,
  type InsertInboxTask,
  users,
  clients,
  jobs,
  lineItems,
  invoices,
  payments,
  employees,
  employeeAssignments,
  timeEntries,
  payrollRecords,
  settings,
  invites,
  inboxTasks,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, gte, lte, sql, isNull, or } from "drizzle-orm";

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

  // Employee Assignments
  getAssignmentsByJob(jobId: string): Promise<EmployeeAssignment[]>;
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

  // Inbox Tasks — per-user (each user's own Gmail connection)
  getUsersWithInboxTasks(): Promise<User[]>;
  getInboxTasks(userId: string): Promise<InboxTask[]>;
  upsertInboxTask(task: InsertInboxTask): Promise<InboxTask>;
  markInboxTaskDone(userId: string, emailId: string, isDone: boolean): Promise<InboxTask | undefined>;
  dismissInboxTask(userId: string, emailId: string): Promise<InboxTask | undefined>;
  snoozeInboxTask(userId: string, emailId: string, until: Date): Promise<InboxTask | undefined>;
  deleteUserInboxTasks(userId: string): Promise<void>;
  deleteAllInboxTasks(): Promise<void>;

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

  async deleteUserInboxTasks(userId: string): Promise<void> {
    await db.delete(inboxTasks).where(eq(inboxTasks.userId, userId));
  }

  async deleteAllInboxTasks(): Promise<void> {
    await db.delete(inboxTasks);
  }

  // Dashboard
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
}

export const storage = new DatabaseStorage();
