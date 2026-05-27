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
import { sendInvoiceEmail, processOverdueReminders, sendPasswordResetEmail } from "./email";
import bcrypt from "bcryptjs";
import { passport, setupOAuthStrategies, getEnabledProviders, callbackUrl } from "./oauth";

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
  // Initialize passport (no session serialization — we manage sessions ourselves)
  app.use(passport.initialize());
  setupOAuthStrategies();

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
      if (password.length < 10) {
        return res.status(400).json({ error: "Password must be at least 10 characters" });
      }
      if (!/[A-Z]/.test(password)) {
        return res.status(400).json({ error: "Password must contain an uppercase letter" });
      }
      if (!/[a-z]/.test(password)) {
        return res.status(400).json({ error: "Password must contain a lowercase letter" });
      }
      if (!/[^A-Za-z0-9]/.test(password)) {
        return res.status(400).json({ error: "Password must contain a special character" });
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

  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { username } = req.body;
      if (!username) return res.status(400).json({ error: "Username required" });

      const user = await storage.getUserByUsername(username);
      // Always respond the same way to prevent username enumeration
      if (!user || !user.email) {
        return res.json({ message: "If that account exists and has an email on file, a reset link has been sent." });
      }

      const token = crypto.randomUUID();
      const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await storage.setResetToken(user.id, token, expiry);

      const protocol = req.headers["x-forwarded-proto"] || "http";
      const host = req.headers.host;
      const resetLink = `${protocol}://${host}/reset-password?token=${token}`;

      await sendPasswordResetEmail(user.email, user.username, resetLink, {
        apiKey: process.env.RESEND_API_KEY,
        provider: "resend",
      });

      res.json({ message: "If that account exists and has an email on file, a reset link has been sent." });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ error: "Failed to process request" });
    }
  });

  app.get("/api/auth/verify-reset-token", async (req, res) => {
    try {
      const { token } = req.query as { token: string };
      if (!token) return res.status(400).json({ error: "Token required" });

      const user = await storage.getUserByResetToken(token);
      if (!user || !user.resetTokenExpiry || new Date(user.resetTokenExpiry) < new Date()) {
        return res.status(400).json({ error: "Invalid or expired reset link" });
      }
      res.json({ valid: true, username: user.username });
    } catch (error) {
      res.status(500).json({ error: "Failed to verify token" });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) return res.status(400).json({ error: "Token and password required" });

      const user = await storage.getUserByResetToken(token);
      if (!user || !user.resetTokenExpiry || new Date(user.resetTokenExpiry) < new Date()) {
        return res.status(400).json({ error: "Invalid or expired reset link" });
      }

      if (password.length < 10) return res.status(400).json({ error: "Password must be at least 10 characters" });
      if (!/[A-Z]/.test(password)) return res.status(400).json({ error: "Password must contain an uppercase letter" });
      if (!/[a-z]/.test(password)) return res.status(400).json({ error: "Password must contain a lowercase letter" });
      if (!/[^A-Za-z0-9]/.test(password)) return res.status(400).json({ error: "Password must contain a special character" });

      const hash = await bcrypt.hash(password, 10);
      await storage.updateUserPassword(user.id, hash);
      await storage.clearResetToken(user.id);

      res.json({ message: "Password updated successfully" });
    } catch (error) {
      console.error("Reset password error:", error);
      res.status(500).json({ error: "Failed to reset password" });
    }
  });

  // ── OAuth social login routes (public) ────────────────────────────────────

  // Which providers are currently configured
  app.get("/api/auth/providers", (_req, res) => {
    res.json(getEnabledProviders());
  });

  // Diagnostic: show the callback URLs this server will use for OAuth
  app.get("/api/auth/callback-urls", (req, res) => {
    const base = getPublicBase(req);
    res.json({
      base,
      google: `${base}/api/auth/google/callback`,
      yahoo: `${base}/api/auth/yahoo/callback`,
      microsoft: `${base}/api/auth/microsoft/callback`,
      apple: `${base}/api/auth/apple/callback`,
    });
  });

  // Helper: finish OAuth flow — set session and redirect
  function oauthSuccess(req: Request, res: Response, user: { id: string }) {
    req.session.userId = user.id;
    req.session.save(() => res.redirect("/"));
  }
  function oauthFail(res: Response) {
    return res.redirect("/?oauth_error=1");
  }

  // Helper: derive the public base URL from the request
  function getPublicBase(req: Request): string {
    const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0].trim() ?? req.protocol;
    const host = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0].trim() ?? req.headers.host ?? "localhost:5000";
    return `${proto}://${host}`;
  }

  // Google
  app.get("/api/auth/google", (req, res, next) => {
    if (!getEnabledProviders().google) return oauthFail(res);
    const cb = `${getPublicBase(req)}/api/auth/google/callback`;
    console.log(`[oauth] Google → callbackURL: ${cb}`);
    passport.authenticate("google", { scope: ["profile", "email"], session: false, callbackURL: cb } as any)(req, res, next);
  });
  app.get("/api/auth/google/callback", (req, res, next) => {
    const cb = `${getPublicBase(req)}/api/auth/google/callback`;
    passport.authenticate("google", { session: false, callbackURL: cb } as any, (err: any, user: any) => {
      if (err || !user) {
        console.error("[oauth] Google callback failed:", err?.message || err);
        return oauthFail(res);
      }
      oauthSuccess(req, res, user);
    })(req, res, next);
  });

  // Microsoft / Outlook
  app.get("/api/auth/microsoft", (req, res, next) => {
    if (!getEnabledProviders().microsoft) return oauthFail(res);
    const cb = `${getPublicBase(req)}/api/auth/microsoft/callback`;
    passport.authenticate("microsoft", { session: false, callbackURL: cb } as any)(req, res, next);
  });
  app.get("/api/auth/microsoft/callback", (req, res, next) => {
    const cb = `${getPublicBase(req)}/api/auth/microsoft/callback`;
    passport.authenticate("microsoft", { session: false, callbackURL: cb } as any, (err: any, user: any) => {
      if (err || !user) return oauthFail(res);
      oauthSuccess(req, res, user);
    })(req, res, next);
  });

  // Apple — callback is POST (Apple spec)
  app.get("/api/auth/apple", (req, res, next) => {
    if (!getEnabledProviders().apple) return oauthFail(res);
    const cb = `${getPublicBase(req)}/api/auth/apple/callback`;
    passport.authenticate("apple", { session: false, callbackURL: cb } as any)(req, res, next);
  });
  app.post("/api/auth/apple/callback", (req, res, next) => {
    const cb = `${getPublicBase(req)}/api/auth/apple/callback`;
    passport.authenticate("apple", { session: false, callbackURL: cb } as any, (err: any, user: any) => {
      if (err || !user) return oauthFail(res);
      oauthSuccess(req, res, user);
    })(req, res, next);
  });

  // Yahoo
  app.get("/api/auth/yahoo", (req, res, next) => {
    if (!getEnabledProviders().yahoo) return oauthFail(res);
    const cb = `${getPublicBase(req)}/api/auth/yahoo/callback`;
    console.log(`[oauth] Yahoo → callbackURL: ${cb}`);
    passport.authenticate("yahoo", { session: false, callbackURL: cb } as any)(req, res, next);
  });
  app.get("/api/auth/yahoo/callback", (req, res, next) => {
    const cb = `${getPublicBase(req)}/api/auth/yahoo/callback`;
    passport.authenticate("yahoo", { session: false, callbackURL: cb } as any, (err: any, user: any) => {
      if (err || !user) return oauthFail(res);
      oauthSuccess(req, res, user);
    })(req, res, next);
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
