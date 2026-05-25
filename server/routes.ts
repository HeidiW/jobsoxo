import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { 
  clients, jobs, invoices, lineItems, payments, employees, timeEntries, users,
  insertClientSchema, insertJobSchema, insertLineItemSchema, insertInvoiceSchema,
  insertPaymentSchema, insertEmployeeSchema, insertTimeEntrySchema, insertSettingsSchema
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { sendInvoiceEmail, processOverdueReminders } from "./email";
import bcrypt from "bcryptjs";

function parseNumeric(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseFloat(value) || 0;
  return 0;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Auth — public routes (no requireAuth)
  app.get("/api/auth/setup-status", async (_req, res) => {
    try {
      const [existing] = await db.select().from(users).limit(1);
      res.json({ needsSetup: !existing });
    } catch (error) {
      res.status(500).json({ error: "Failed to check setup status" });
    }
  });

  app.post("/api/auth/register", async (req, res) => {
    try {
      const [existing] = await db.select().from(users).limit(1);
      if (existing) {
        return res.status(403).json({ error: "Setup already complete" });
      }
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }
      const hash = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username, password: hash });
      req.session.userId = user.id;
      res.status(201).json({ id: user.id, username: user.username });
    } catch (error) {
      console.error("Register error:", error);
      res.status(500).json({ error: "Failed to create account" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }
      const user = await storage.getUserByUsername(username);
      if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: "Invalid username or password" });
      }
      req.session.userId = user.id;
      res.json({ id: user.id, username: user.username });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Failed to log in" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      const user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      res.json({ id: user.id, username: user.username });
    } catch (error) {
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  // All routes below require authentication
  app.use("/api", requireAuth);

  // Dashboard
  app.get("/api/dashboard", async (req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      
      const recentInvoicesRaw = await db
        .select()
        .from(invoices)
        .orderBy(invoices.createdAt)
        .limit(5);
      
      const recentInvoices = await Promise.all(
        recentInvoicesRaw.map(async (invoice) => {
          const client = await storage.getClient(invoice.clientId);
          return { ...invoice, client };
        })
      );

      const upcomingJobsRaw = await db
        .select()
        .from(jobs)
        .where(eq(jobs.status, "scheduled"))
        .orderBy(jobs.startDate)
        .limit(5);

      const upcomingJobs = await Promise.all(
        upcomingJobsRaw.map(async (job) => {
          const client = await storage.getClient(job.clientId);
          return { ...job, client };
        })
      );

      res.json({
        stats,
        recentInvoices,
        upcomingJobs,
      });
    } catch (error) {
      console.error("Dashboard error:", error);
      res.status(500).json({ error: "Failed to load dashboard" });
    }
  });

  // Clients
  app.get("/api/clients", async (req, res) => {
    try {
      const allClients = await storage.getClients();
      const clientsWithStats = await Promise.all(
        allClients.map(async (client) => {
          const stats = await storage.getClientStats(client.id);
          return { ...client, ...stats };
        })
      );
      res.json(clientsWithStats);
    } catch (error) {
      console.error("Get clients error:", error);
      res.status(500).json({ error: "Failed to get clients" });
    }
  });

  app.get("/api/clients/:id", async (req, res) => {
    try {
      const client = await storage.getClient(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      res.json(client);
    } catch (error) {
      console.error("Get client error:", error);
      res.status(500).json({ error: "Failed to get client" });
    }
  });

  app.post("/api/clients", async (req, res) => {
    try {
      const client = await storage.createClient(req.body);
      res.status(201).json(client);
    } catch (error) {
      console.error("Create client error:", error);
      res.status(500).json({ error: "Failed to create client" });
    }
  });

  app.patch("/api/clients/:id", async (req, res) => {
    try {
      const client = await storage.updateClient(req.params.id, req.body);
      if (!client) {
        return res.status(404).json({ error: "Client not found" });
      }
      res.json(client);
    } catch (error) {
      console.error("Update client error:", error);
      res.status(500).json({ error: "Failed to update client" });
    }
  });

  app.delete("/api/clients/:id", async (req, res) => {
    try {
      await storage.deleteClient(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Delete client error:", error);
      res.status(500).json({ error: "Failed to delete client" });
    }
  });

  // Jobs
  app.get("/api/jobs", async (req, res) => {
    try {
      const allJobs = await storage.getJobs();
      const jobsWithClients = await Promise.all(
        allJobs.map(async (job) => {
          const client = await storage.getClient(job.clientId);
          return { ...job, client };
        })
      );
      res.json(jobsWithClients);
    } catch (error) {
      console.error("Get jobs error:", error);
      res.status(500).json({ error: "Failed to get jobs" });
    }
  });

  app.get("/api/jobs/:id", async (req, res) => {
    try {
      const job = await storage.getJob(req.params.id);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
      const client = await storage.getClient(job.clientId);
      res.json({ ...job, client });
    } catch (error) {
      console.error("Get job error:", error);
      res.status(500).json({ error: "Failed to get job" });
    }
  });

  app.post("/api/jobs", async (req, res) => {
    try {
      const job = await storage.createJob(req.body);
      res.status(201).json(job);
    } catch (error) {
      console.error("Create job error:", error);
      res.status(500).json({ error: "Failed to create job" });
    }
  });

  app.patch("/api/jobs/:id", async (req, res) => {
    try {
      const job = await storage.updateJob(req.params.id, req.body);
      if (!job) {
        return res.status(404).json({ error: "Job not found" });
      }
      res.json(job);
    } catch (error) {
      console.error("Update job error:", error);
      res.status(500).json({ error: "Failed to update job" });
    }
  });

  app.delete("/api/jobs/:id", async (req, res) => {
    try {
      await storage.deleteJob(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Delete job error:", error);
      res.status(500).json({ error: "Failed to delete job" });
    }
  });

  // Line Items
  app.get("/api/jobs/:id/line-items", async (req, res) => {
    try {
      const items = await storage.getLineItems(req.params.id);
      res.json(items);
    } catch (error) {
      console.error("Get line items error:", error);
      res.status(500).json({ error: "Failed to get line items" });
    }
  });

  app.post("/api/line-items", async (req, res) => {
    try {
      const item = await storage.createLineItem(req.body);
      res.status(201).json(item);
    } catch (error) {
      console.error("Create line item error:", error);
      res.status(500).json({ error: "Failed to create line item" });
    }
  });

  app.patch("/api/line-items/:id", async (req, res) => {
    try {
      const item = await storage.updateLineItem(req.params.id, req.body);
      if (!item) {
        return res.status(404).json({ error: "Line item not found" });
      }
      res.json(item);
    } catch (error) {
      console.error("Update line item error:", error);
      res.status(500).json({ error: "Failed to update line item" });
    }
  });

  app.delete("/api/line-items/:id", async (req, res) => {
    try {
      await storage.deleteLineItem(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Delete line item error:", error);
      res.status(500).json({ error: "Failed to delete line item" });
    }
  });

  // Invoices
  app.get("/api/invoices", async (req, res) => {
    try {
      const allInvoices = await storage.getInvoices();
      const invoicesWithRelations = await Promise.all(
        allInvoices.map(async (invoice) => {
          const client = await storage.getClient(invoice.clientId);
          const job = invoice.jobId ? await storage.getJob(invoice.jobId) : null;
          return { ...invoice, client, job };
        })
      );
      res.json(invoicesWithRelations);
    } catch (error) {
      console.error("Get invoices error:", error);
      res.status(500).json({ error: "Failed to get invoices" });
    }
  });

  app.get("/api/invoices/:id", async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      const client = await storage.getClient(invoice.clientId);
      const job = invoice.jobId ? await storage.getJob(invoice.jobId) : null;
      const invoiceLineItems = await db
        .select()
        .from(lineItems)
        .where(eq(lineItems.invoiceId, invoice.id));
      const invoicePayments = await storage.getPaymentsByInvoice(invoice.id);
      
      res.json({
        ...invoice,
        client,
        job,
        lineItems: invoiceLineItems,
        payments: invoicePayments,
      });
    } catch (error) {
      console.error("Get invoice error:", error);
      res.status(500).json({ error: "Failed to get invoice" });
    }
  });

  app.post("/api/invoices", async (req, res) => {
    try {
      const { lineItems: items, send, ...invoiceData } = req.body;
      
      let subtotal = 0;
      if (items && items.length > 0) {
        for (const item of items) {
          const quantity = parseNumeric(item.quantity);
          const rate = parseNumeric(item.rate);
          subtotal += quantity * rate;
        }
      }
      
      const taxRate = parseNumeric(invoiceData.taxRate);
      const taxAmount = subtotal * (taxRate / 100);
      const total = subtotal + taxAmount;
      
      const invoiceNumber = await storage.getNextInvoiceNumber();
      
      const invoice = await storage.createInvoice({
        clientId: invoiceData.clientId,
        jobId: invoiceData.jobId || null,
        invoiceNumber,
        status: "draft",
        subtotal: String(subtotal),
        taxRate: String(taxRate),
        taxAmount: String(taxAmount),
        total: String(total),
        balance: String(total),
        issueDate: new Date().toISOString(),
        dueDate: invoiceData.dueDate,
        notes: invoiceData.notes || null,
        termsAndConditions: invoiceData.termsAndConditions || null,
        amountPaid: "0",
        reminderCount: 0,
      });

      if (items && items.length > 0) {
        for (const item of items) {
          const quantity = parseNumeric(item.quantity);
          const rate = parseNumeric(item.rate);
          const amount = quantity * rate;
          
          await storage.createLineItem({
            category: item.category,
            description: item.description,
            quantity: String(quantity),
            unit: item.unit,
            rate: String(rate),
            amount: String(amount),
            isChangeOrder: item.isChangeOrder || false,
            changeOrderReason: item.changeOrderReason || null,
            jobId: invoiceData.jobId || null,
            invoiceId: invoice.id,
          });
        }
      }

      if (send) {
        const client = await storage.getClient(invoice.clientId);
        if (client?.email && process.env.RESEND_API_KEY) {
          const emailResult = await sendInvoiceEmail(invoice.id, client.email, {
            apiKey: process.env.RESEND_API_KEY,
            provider: "resend",
          });
          if (emailResult.success) {
            const updated = await storage.updateInvoice(invoice.id, { status: "sent" });
            return res.status(201).json(updated);
          }
          return res.status(201).json({
            ...invoice,
            emailError: emailResult.error || "Failed to send email",
          });
        }
      }

      res.status(201).json(invoice);
    } catch (error) {
      console.error("Create invoice error:", error);
      res.status(500).json({ error: "Failed to create invoice" });
    }
  });

  app.post("/api/invoices/:id/send", async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      
      const client = await storage.getClient(invoice.clientId);
      if (!client?.email) {
        return res.status(400).json({ error: "Client has no email address on file" });
      }
      if (!process.env.RESEND_API_KEY) {
        return res.status(500).json({ error: "Email service is not configured" });
      }

      const emailResult = await sendInvoiceEmail(req.params.id, client.email, {
        apiKey: process.env.RESEND_API_KEY,
        provider: "resend",
      });

      if (!emailResult.success) {
        return res.status(502).json({ error: emailResult.error || "Failed to send email" });
      }

      const updated = await storage.updateInvoice(req.params.id, {
        status: "sent",
      });

      res.json(updated);
    } catch (error) {
      console.error("Send invoice error:", error);
      res.status(500).json({ error: "Failed to send invoice" });
    }
  });

  app.post("/api/reminders/process", async (req, res) => {
    try {
      const result = await processOverdueReminders();
      res.json(result);
    } catch (error) {
      console.error("Process reminders error:", error);
      res.status(500).json({ error: "Failed to process reminders" });
    }
  });

  app.post("/api/invoices/:id/mark-paid", async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }
      
      const updated = await storage.updateInvoice(req.params.id, {
        status: "paid",
        amountPaid: invoice.total,
        balance: "0",
      });
      
      res.json(updated);
    } catch (error) {
      console.error("Mark paid error:", error);
      res.status(500).json({ error: "Failed to mark invoice as paid" });
    }
  });

  app.post("/api/invoices/:id/payments", async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }

      const payment = await storage.createPayment({
        ...req.body,
        invoiceId: req.params.id,
      });

      const newAmountPaid = Number(invoice.amountPaid) + Number(req.body.amount);
      const newBalance = Number(invoice.total) - newAmountPaid;
      
      await storage.updateInvoice(req.params.id, {
        amountPaid: String(newAmountPaid),
        balance: String(newBalance),
        status: newBalance <= 0 ? "paid" : "partial",
      });

      res.status(201).json(payment);
    } catch (error) {
      console.error("Create payment error:", error);
      res.status(500).json({ error: "Failed to record payment" });
    }
  });

  // Employees
  app.get("/api/employees", async (req, res) => {
    try {
      const allEmployees = await storage.getEmployees();
      
      const now = new Date();
      const startOfPeriod = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfPeriod = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const employeesWithStats = await Promise.all(
        allEmployees.map(async (employee) => {
          const entries = await storage.getTimeEntriesByEmployee(employee.id);
          const periodEntries = entries.filter((entry) => {
            const entryDate = new Date(entry.date);
            return entryDate >= startOfPeriod && entryDate <= endOfPeriod;
          });
          
          const hoursThisPeriod = periodEntries.reduce(
            (sum, entry) => sum + Number(entry.hoursWorked),
            0
          );
          const totalPay = hoursThisPeriod * Number(employee.hourlyRate);
          
          return { ...employee, hoursThisPeriod, totalPay };
        })
      );

      res.json(employeesWithStats);
    } catch (error) {
      console.error("Get employees error:", error);
      res.status(500).json({ error: "Failed to get employees" });
    }
  });

  app.get("/api/employees/:id", async (req, res) => {
    try {
      const employee = await storage.getEmployee(req.params.id);
      if (!employee) {
        return res.status(404).json({ error: "Employee not found" });
      }
      res.json(employee);
    } catch (error) {
      console.error("Get employee error:", error);
      res.status(500).json({ error: "Failed to get employee" });
    }
  });

  app.post("/api/employees", async (req, res) => {
    try {
      const employee = await storage.createEmployee(req.body);
      res.status(201).json(employee);
    } catch (error) {
      console.error("Create employee error:", error);
      res.status(500).json({ error: "Failed to create employee" });
    }
  });

  app.patch("/api/employees/:id", async (req, res) => {
    try {
      const employee = await storage.updateEmployee(req.params.id, req.body);
      if (!employee) {
        return res.status(404).json({ error: "Employee not found" });
      }
      res.json(employee);
    } catch (error) {
      console.error("Update employee error:", error);
      res.status(500).json({ error: "Failed to update employee" });
    }
  });

  app.delete("/api/employees/:id", async (req, res) => {
    try {
      await storage.deleteEmployee(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Delete employee error:", error);
      res.status(500).json({ error: "Failed to delete employee" });
    }
  });

  // Time Entries
  app.get("/api/time-entries", async (req, res) => {
    try {
      const allEntries = await storage.getTimeEntries();
      const entriesWithRelations = await Promise.all(
        allEntries.map(async (entry) => {
          const employee = await storage.getEmployee(entry.employeeId);
          const job = entry.jobId ? await storage.getJob(entry.jobId) : null;
          return { ...entry, employee, job };
        })
      );
      res.json(entriesWithRelations);
    } catch (error) {
      console.error("Get time entries error:", error);
      res.status(500).json({ error: "Failed to get time entries" });
    }
  });

  app.post("/api/time-entries", async (req, res) => {
    try {
      const entry = await storage.createTimeEntry(req.body);
      res.status(201).json(entry);
    } catch (error) {
      console.error("Create time entry error:", error);
      res.status(500).json({ error: "Failed to create time entry" });
    }
  });

  // Settings
  app.get("/api/settings", async (req, res) => {
    try {
      let settings = await storage.getSettings();
      if (!settings) {
        settings = await storage.updateSettings({
          invoicePrefix: "INV",
          taxRate: "0",
          invoiceTerms: "Payment is due within 30 days. Late payments may incur additional fees.",
          reminderIntervals: [7, 14, 30],
        });
      }
      res.json(settings);
    } catch (error) {
      console.error("Get settings error:", error);
      res.status(500).json({ error: "Failed to get settings" });
    }
  });

  app.patch("/api/settings", async (req, res) => {
    try {
      const settings = await storage.updateSettings(req.body);
      res.json(settings);
    } catch (error) {
      console.error("Update settings error:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  return httpServer;
}
