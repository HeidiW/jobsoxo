import { createRequire } from "node:module";
// Function declaration (not const) so it's hoisted and immune to TDZ in circular-dep scenarios.
// import.meta.url is valid in ESM (dev/tsx) but undefined in CJS bundles (production build).
// Falls back to process.cwd() path so createRequire can still resolve node_modules.
function _require(id: string): any {
  const req = createRequire(
    (typeof import.meta !== "undefined" && import.meta.url)
      ? import.meta.url
      : `file://${process.cwd()}/server.js`
  );
  return req(id);
}
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { db } from "./db";
import { 
  clients, jobs, invoices, lineItems, payments, employees, timeEntries, users, changeOrders,
  insertClientSchema, insertJobSchema, insertLineItemSchema, insertInvoiceSchema,
  insertPaymentSchema, insertEmployeeSchema, insertTimeEntrySchema, insertSettingsSchema,
  insertPayrollRecordSchema, insertChangeOrderSchema
} from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { sendInvoiceEmail, processOverdueReminders, sendPasswordResetEmail } from "./email";
import bcrypt from "bcryptjs";
import { passport, setupOAuthStrategies, getEnabledProviders, callbackUrl } from "./oauth";
import {
  isGmailConnected, fetchGmailInbox, revokeGmailConnection, getGmailOAuthUrl,
  buildGmailAuthUrl, exchangeGmailCode,
  isUserGmailConnected, getUserGmailEmail, fetchUserGmailInbox, revokeUserGmailToken,
  fetchGmailLabelsForUser,
} from "./gmail";
import { getLastInboxSyncTime, getNextInboxSyncTime, syncInboxForConnectedUsers } from "./scheduler";
import { handleInboundSms, twimlReply } from "./sms";
import { sendChangeOrderEmail } from "./email";
import twilio from "twilio";
import { parseDocumentText } from "./document-parser";

function parseNumeric(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseFloat(value) || 0;
  return 0;
}

function badRequest(res: Response, err: z.ZodError) {
  return res.status(400).json({ error: "Invalid request data", details: err.flatten().fieldErrors });
}

async function recalcInvoiceTotals(invoiceId: string): Promise<void> {
  const invoice = await storage.getInvoice(invoiceId);
  if (!invoice) return;
  const allLineItems = await db.select().from(lineItems).where(eq(lineItems.invoiceId, invoiceId));
  const lineItemsSubtotal = allLineItems.reduce((s, i) => s + Number(i.amount), 0);
  const approvedCOs = await db.select().from(changeOrders)
    .where(eq(changeOrders.invoiceId, invoiceId));
  const coSubtotal = approvedCOs
    .filter((co) => co.status === "approved")
    .reduce((s, co) => s + Number(co.amount), 0);
  const newSubtotal = lineItemsSubtotal + coSubtotal;
  const taxRate = Number(invoice.taxRate) || 0;
  const newTax = newSubtotal * (taxRate / 100);
  const newTotal = newSubtotal + newTax;
  const alreadyPaid = Number(invoice.amountPaid) || 0;
  const newBalance = newTotal - alreadyPaid;
  const currentStatus = invoice.status;
  let newStatus = currentStatus;
  if (newBalance <= 0 && currentStatus !== "paid") newStatus = "paid";
  else if (newBalance > 0 && currentStatus === "paid") newStatus = "partial";
  await storage.updateInvoice(invoiceId, {
    subtotal: String(newSubtotal),
    taxAmount: String(newTax),
    total: String(newTotal),
    balance: String(Math.max(0, newBalance)),
    status: newStatus,
  });
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

  function validatePassword(password: string): string | null {
    if (password.length < 10) return "Password must be at least 10 characters";
    if (!/[A-Z]/.test(password)) return "Password must contain an uppercase letter";
    if (!/[a-z]/.test(password)) return "Password must contain a lowercase letter";
    if (!/[^A-Za-z0-9]/.test(password)) return "Password must contain a special character";
    return null;
  }

  // First-time setup — creates the admin account (only when no users exist)
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
      const pwErr = validatePassword(password);
      if (pwErr) return res.status(400).json({ error: pwErr });
      const hash = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username, password: hash, isAdmin: true });
      req.session.userId = user.id;
      res.status(201).json({ id: user.id, username: user.username, isAdmin: user.isAdmin });
    } catch (error) {
      console.error("Register error:", error);
      res.status(500).json({ error: "Failed to create account" });
    }
  });

  // Invite-based signup — requires a valid unused invite code
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { username, password, inviteCode } = req.body;
      if (!username || !password || !inviteCode) {
        return res.status(400).json({ error: "Username, password, and invite code are required" });
      }
      const pwErr = validatePassword(password);
      if (pwErr) return res.status(400).json({ error: pwErr });
      const invite = await storage.getInviteByCode(inviteCode.trim().toUpperCase());
      if (!invite) return res.status(400).json({ error: "Invalid invite code" });
      if (invite.usedAt) return res.status(400).json({ error: "This invite code has already been used" });
      const hash = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username, password: hash, isAdmin: false });
      await storage.markInviteUsed(invite.code, user.id);
      req.session.userId = user.id;
      res.status(201).json({ id: user.id, username: user.username, isAdmin: user.isAdmin });
    } catch (error: any) {
      if (error?.code === "23505") return res.status(409).json({ error: "Username already taken" });
      console.error("Signup error:", error);
      res.status(500).json({ error: "Failed to create account" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
      }
      const user = await storage.getUserByUsernameOrEmail(username);
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
      let user = await storage.getUser(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      // Self-heal: if no admin exists yet (e.g. after first migration), promote current user
      if (!user.isAdmin) {
        const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.isAdmin, true));
        if (Number(count) === 0) {
          await db.update(users).set({ isAdmin: true }).where(eq(users.id, user.id));
          user = { ...user, isAdmin: true };
        }
      }
      res.json({ id: user.id, username: user.username, isAdmin: user.isAdmin });
    } catch (error) {
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { username } = req.body;
      if (!username) return res.status(400).json({ error: "Username or email required" });

      const user = await storage.getUserByUsernameOrEmail(username);
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

  // ── SMS inbound webhook (public — Twilio posts here) ─────────────────────
  app.post("/api/sms/inbound", async (req, res) => {
    try {
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (!authToken) {
        console.error("SMS webhook: TWILIO_AUTH_TOKEN is not configured — rejecting request");
        res.status(403).type("text/xml").send(twimlReply("Service not configured"));
        return;
      }
      const sig = (req.headers["x-twilio-signature"] as string) || "";
      const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0].trim() ?? req.protocol;
      const host = (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0].trim() ?? req.headers.host ?? "localhost:5000";
      const url = `${proto}://${host}${req.originalUrl}`;
      const isValid = twilio.validateRequest(authToken, sig, url, req.body as Record<string, string>);
      if (!isValid) {
        res.status(403).type("text/xml").send(twimlReply("Forbidden"));
        return;
      }
      const from: string = req.body?.From ?? "";
      const body: string = req.body?.Body ?? "";
      if (!from) {
        res.type("text/xml").send(twimlReply("Missing sender"));
        return;
      }
      const reply = await handleInboundSms(from, body);
      res.type("text/xml").send(reply);
    } catch (error) {
      console.error("SMS inbound error:", error);
      res.type("text/xml").send(twimlReply("An error occurred. Please try again."));
    }
  });

  // All routes below require authentication
  app.use("/api", requireAuth);

  // Dashboard
  app.get("/api/dashboard", async (req, res) => {
    try {
      const now = new Date();
      const hour = now.getHours();
      const timeOfDay = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

      // Greeting
      const user = req.session?.userId ? await storage.getUser(req.session.userId as string) : null;
      const firstName = user?.username ? user.username.split(/[\s_@.]/)[0] : "there";

      // Date boundaries
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const todayEnd   = new Date(now); todayEnd.setHours(23, 59, 59, 999);
      const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      const dueSoonDate = new Date(todayStart); dueSoonDate.setDate(dueSoonDate.getDate() + 30);

      // All invoices with client + job names
      const allInvoices = await db
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          clientId: invoices.clientId,
          jobId: invoices.jobId,
          status: invoices.status,
          total: invoices.total,
          balance: invoices.balance,
          dueDate: invoices.dueDate,
          clientName: clients.name,
          jobTitle: jobs.title,
        })
        .from(invoices)
        .leftJoin(clients, eq(invoices.clientId, clients.id))
        .leftJoin(jobs, eq(invoices.jobId, jobs.id));

      const openStatuses = ["sent", "partial", "overdue"];
      const openInvoices = allInvoices.filter(r => openStatuses.includes(r.status));
      const outstanding = {
        total: openInvoices.reduce((s, r) => s + Number(r.balance), 0),
        invoiceCount: openInvoices.length,
        clientCount: new Set(openInvoices.map(r => r.clientId)).size,
        overdue: openInvoices
          .filter(r => r.status === "overdue")
          .reduce((s, r) => s + Number(r.balance), 0),
        dueSoon: openInvoices
          .filter(r => {
            if (r.status !== "sent" || !r.dueDate) return false;
            const dd = new Date(r.dueDate);
            return dd >= todayStart && dd <= dueSoonDate;
          })
          .reduce((s, r) => s + Number(r.balance), 0),
        draft: allInvoices
          .filter(r => r.status === "draft")
          .reduce((s, r) => s + Number(r.total), 0),
      };

      // Payments — this month vs last month
      const [thisMonthPmt, lastMonthPmt] = await Promise.all([
        db.select({ total: sql<number>`COALESCE(SUM(${payments.amount}::numeric), 0)` })
          .from(payments)
          .where(sql`${payments.paymentDate} >= ${startOfThisMonth}`),
        db.select({ total: sql<number>`COALESCE(SUM(${payments.amount}::numeric), 0)` })
          .from(payments)
          .where(sql`${payments.paymentDate} >= ${startOfLastMonth} AND ${payments.paymentDate} <= ${endOfLastMonth}`),
      ]);
      const thisAmt = Number(thisMonthPmt[0]?.total) || 0;
      const lastAmt = Number(lastMonthPmt[0]?.total) || 0;
      const momDeltaPct = lastAmt > 0 ? Math.round(((thisAmt - lastAmt) / lastAmt) * 100) : (thisAmt > 0 ? 100 : 0);

      // Active jobs + crew / hours today
      const [activeJobsRows, hoursTodayRows, crewsTodayRows] = await Promise.all([
        db.select({ count: sql<number>`count(*)` }).from(jobs).where(sql`${jobs.status} = 'in_progress'`),
        db.select({ total: sql<number>`COALESCE(SUM(${timeEntries.hoursWorked}::numeric), 0)` })
          .from(timeEntries).where(sql`DATE(${timeEntries.date}) = CURRENT_DATE`),
        db.select({ count: sql<number>`COUNT(DISTINCT ${timeEntries.employeeId})` })
          .from(timeEntries).where(sql`DATE(${timeEntries.date}) = CURRENT_DATE`),
      ]);

      // Needs attention — overdue OR due today, sorted most overdue first
      const needsAttention = allInvoices
        .filter(r => {
          if (r.status === "overdue") return true;
          if ((r.status === "sent" || r.status === "partial") && r.dueDate) {
            const dd = new Date(r.dueDate);
            return dd >= todayStart && dd <= todayEnd;
          }
          return false;
        })
        .map(r => {
          const dueDate = r.dueDate ? new Date(r.dueDate) : null;
          let reason: "overdue" | "due-today" | "deposit-due" = "due-today";
          let detail = "Due today";
          let daysOverdue = 0;
          if (r.status === "overdue") {
            reason = "overdue";
            daysOverdue = dueDate
              ? Math.floor((todayStart.getTime() - dueDate.getTime()) / 86_400_000)
              : 0;
            detail = `${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} overdue`;
          } else if (r.status === "partial") {
            detail = "Balance due today · partially paid";
          }
          return { invoiceId: r.id, invoiceNumber: r.invoiceNumber, client: r.clientName || "Unknown", project: r.jobTitle ?? undefined, reason, detail, balance: Number(r.balance), daysOverdue };
        })
        .sort((a, b) => b.daysOverdue - a.daysOverdue);

      // This week Mon–Fri
      const dow = now.getDay();
      const monday = new Date(todayStart);
      monday.setDate(todayStart.getDate() - (dow === 0 ? 6 : dow - 1));
      const friday = new Date(monday); friday.setDate(monday.getDate() + 4);

      const weekJobs = await db
        .select({ id: jobs.id, title: jobs.title, startDate: jobs.startDate, endDate: jobs.endDate })
        .from(jobs)
        .where(sql`${jobs.startDate} IS NOT NULL AND ${jobs.startDate} <= ${friday} AND (${jobs.endDate} IS NULL OR ${jobs.endDate} >= ${monday})`);

      const JOB_COLORS = ["#3b82f6","#10b981","#8b5cf6","#f59e0b","#ef4444","#06b6d4","#f97316"];
      const colorMap = new Map<string, string>();
      let ci = 0;
      const getColor = (id: string) => { if (!colorMap.has(id)) colorMap.set(id, JOB_COLORS[ci++ % JOB_COLORS.length]); return colorMap.get(id)!; };
      const WDAYS = ["MON","TUE","WED","THU","FRI"];

      const week = Array.from({ length: 5 }, (_, i) => {
        const day = new Date(monday); day.setDate(monday.getDate() + i);
        const dayS = new Date(day); dayS.setHours(0,0,0,0);
        const dayE = new Date(day); dayE.setHours(23,59,59,999);
        return {
          date: day.toISOString().split("T")[0],
          weekday: WDAYS[i],
          dayNum: day.getDate(),
          isToday: dayS.getTime() === todayStart.getTime(),
          jobs: weekJobs
            .filter(j => {
              if (!j.startDate) return false;
              const s = new Date(j.startDate); s.setHours(0,0,0,0);
              const e = j.endDate ? new Date(j.endDate) : s; e.setHours(23,59,59,999);
              return s <= dayE && e >= dayS;
            })
            .map(j => ({ jobId: j.id, label: j.title, crewSize: 0, color: getColor(j.id) })),
        };
      });

      res.json({
        outstanding,
        collectedThisMonth: { amount: thisAmt, momDeltaPct },
        activeJobs: { count: Number(activeJobsRows[0]?.count) || 0, crews: Number(crewsTodayRows[0]?.count) || 0, hoursToday: Math.round(Number(hoursTodayRows[0]?.total) || 0) },
        needsAttention,
        week,
        greeting: { firstName, timeOfDay },
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
      const parsed = insertClientSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const client = await storage.createClient(parsed.data);
      res.status(201).json(client);
    } catch (error) {
      console.error("Create client error:", error);
      res.status(500).json({ error: "Failed to create client" });
    }
  });

  app.patch("/api/clients/:id", async (req, res) => {
    try {
      const parsed = insertClientSchema.partial().safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const client = await storage.updateClient(req.params.id, parsed.data);
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

      // Invoices linked to this job, with their line items
      const jobInvoices = await storage.getInvoices();
      const linkedInvoices = jobInvoices.filter((inv) => inv.jobId === job.id);
      const invoicesWithItems = await Promise.all(
        linkedInvoices.map(async (inv) => {
          const items = await db
            .select()
            .from(lineItems)
            .where(eq(lineItems.invoiceId, inv.id));
          return { ...inv, lineItems: items };
        })
      );

      // Employee assignments with employee details
      const assignments = await storage.getAssignmentsByJob(job.id);
      const assignedEmployees = await Promise.all(
        assignments.map((a) => storage.getEmployee(a.employeeId))
      );

      // Outstanding balance across all invoices for this job
      const outstandingBalance = linkedInvoices.reduce(
        (sum, inv) => sum + Number(inv.balance ?? 0),
        0
      );

      res.json({
        ...job,
        client,
        invoices: invoicesWithItems,
        employees: assignedEmployees.filter(Boolean),
        outstandingBalance: String(outstandingBalance),
      });
    } catch (error) {
      console.error("Get job error:", error);
      res.status(500).json({ error: "Failed to get job" });
    }
  });

  app.post("/api/jobs", async (req, res) => {
    try {
      const parsed = insertJobSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const job = await storage.createJob(parsed.data);
      res.status(201).json(job);
    } catch (error) {
      console.error("Create job error:", error);
      res.status(500).json({ error: "Failed to create job" });
    }
  });

  app.patch("/api/jobs/:id", async (req, res) => {
    try {
      const parsed = insertJobSchema.partial().safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const job = await storage.updateJob(req.params.id, parsed.data);
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

  // Job Documents
  const multerDocLib = _require("multer") as typeof import("multer").default;
  const docUpload = multerDocLib({ storage: multerDocLib.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

  app.get("/api/jobs/:id/documents", async (req, res) => {
    try {
      const docs = await storage.getJobDocuments(req.params.id);
      res.json(docs.map(({ fileData: _fd, ...rest }) => rest));
    } catch (error) {
      console.error("Get job documents error:", error);
      res.status(500).json({ error: "Failed to get documents" });
    }
  });

  app.post("/api/jobs/:id/documents", (req, res) => {
    docUpload.single("file")(req, res, async (err) => {
      if (err) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(413).json({ error: "File too large. Maximum size is 10 MB." });
        }
        console.error("Upload middleware error:", err);
        return res.status(500).json({ error: "Failed to upload document" });
      }
      try {
        const job = await storage.getJob(req.params.id);
        if (!job) return res.status(404).json({ error: "Job not found" });
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        const fileData = req.file.buffer.toString("base64");
        const doc = await storage.createJobDocument({
          jobId: req.params.id,
          fileName: req.file.originalname,
          fileType: req.file.mimetype,
          fileSize: req.file.size,
          fileData,
        });
        const { fileData: _fd, ...rest } = doc;
        res.status(201).json(rest);
      } catch (error) {
        console.error("Upload document error:", error);
        res.status(500).json({ error: "Failed to upload document" });
      }
    });
  });

  app.get("/api/job-documents/:docId/download", async (req, res) => {
    try {
      const doc = await storage.getJobDocument(req.params.docId);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      const buffer = Buffer.from(doc.fileData, "base64");
      res.setHeader("Content-Type", doc.fileType);
      res.setHeader("Content-Disposition", `attachment; filename="${doc.fileName}"`);
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (error) {
      console.error("Download document error:", error);
      res.status(500).json({ error: "Failed to download document" });
    }
  });

  app.delete("/api/job-documents/:docId", async (req, res) => {
    try {
      const doc = await storage.getJobDocument(req.params.docId);
      if (!doc) return res.status(404).json({ error: "Document not found" });
      await storage.deleteJobDocument(req.params.docId);
      res.status(204).send();
    } catch (error) {
      console.error("Delete document error:", error);
      res.status(500).json({ error: "Failed to delete document" });
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
      const parsed = insertLineItemSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const item = await storage.createLineItem(parsed.data);
      res.status(201).json(item);
    } catch (error) {
      console.error("Create line item error:", error);
      res.status(500).json({ error: "Failed to create line item" });
    }
  });

  app.patch("/api/line-items/:id", async (req, res) => {
    try {
      const existing = await storage.getLineItem(req.params.id);
      if (!existing) return res.status(404).json({ error: "Line item not found" });
      const parsed = insertLineItemSchema.partial().safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const item = await storage.updateLineItem(req.params.id, parsed.data);
      if (!item) return res.status(404).json({ error: "Line item not found" });
      if (existing.invoiceId) await recalcInvoiceTotals(existing.invoiceId);
      res.json(item);
    } catch (error) {
      console.error("Update line item error:", error);
      res.status(500).json({ error: "Failed to update line item" });
    }
  });

  app.delete("/api/line-items/:id", async (req, res) => {
    try {
      const existing = await storage.getLineItem(req.params.id);
      if (!existing) return res.status(404).json({ error: "Line item not found" });
      await storage.deleteLineItem(req.params.id);
      if (existing.invoiceId) await recalcInvoiceTotals(existing.invoiceId);
      res.status(204).send();
    } catch (error) {
      console.error("Delete line item error:", error);
      res.status(500).json({ error: "Failed to delete line item" });
    }
  });

  // Add a line item (incl. change orders) to an existing invoice and recalc totals
  app.post("/api/invoices/:id/line-items", async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });

      const bodySchema = z.object({
        category: z.string().min(1),
        description: z.string().min(1),
        quantity: z.coerce.number().positive(),
        unit: z.string().min(1),
        rate: z.coerce.number().positive(),
        isChangeOrder: z.boolean().optional().default(false),
        changeOrderReason: z.string().optional().nullable(),
        section: z.string().optional().nullable(),
        refs: z.string().optional().nullable(),
      });
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);

      const { quantity, rate, ...rest } = parsed.data;
      const amount = quantity * rate;

      const newItem = await storage.createLineItem({
        invoiceId: invoice.id,
        jobId: invoice.jobId ?? null,
        category: rest.category,
        description: rest.description,
        quantity: String(quantity),
        unit: rest.unit,
        rate: String(rate),
        amount: String(amount),
        isChangeOrder: rest.isChangeOrder,
        changeOrderReason: rest.changeOrderReason ?? null,
        section: rest.section ?? null,
        refs: rest.refs ?? null,
      });

      // Recalculate invoice totals from all its line items
      const allItems = await db
        .select()
        .from(lineItems)
        .where(eq(lineItems.invoiceId, invoice.id));
      const newSubtotal = allItems.reduce((s, i) => s + Number(i.amount), 0);
      const newTax = newSubtotal * (Number(invoice.taxRate) / 100);
      const newTotal = newSubtotal + newTax;
      const alreadyPaid = Number(invoice.amountPaid);
      const newBalance = newTotal - alreadyPaid;

      await storage.updateInvoice(invoice.id, {
        subtotal: String(newSubtotal),
        taxAmount: String(newTax),
        total: String(newTotal),
        balance: String(newBalance),
        status: newBalance <= 0 ? "paid" : invoice.status === "paid" ? "partial" : invoice.status,
      });

      res.status(201).json(newItem);
    } catch (error) {
      console.error("Add invoice line item error:", error);
      res.status(500).json({ error: "Failed to add line item" });
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

  app.get("/api/change-orders", async (req, res) => {
    try {
      const orders = await storage.getAllChangeOrders();
      res.json(orders);
    } catch (error) {
      console.error("Get change orders error:", error);
      res.status(500).json({ error: "Failed to get change orders" });
    }
  });

  app.post("/api/change-orders", async (req, res) => {
    try {
      const parsed = insertChangeOrderSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const invoice = await storage.getInvoice(parsed.data.invoiceId);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      const order = await storage.createChangeOrder(parsed.data);
      res.status(201).json(order);
    } catch (error) {
      res.status(500).json({ error: "Failed to create change order" });
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
      const invoiceChangeOrders = await storage.getChangeOrdersByInvoice(invoice.id);
      
      res.json({
        ...invoice,
        client,
        job,
        lineItems: invoiceLineItems,
        payments: invoicePayments,
        changeOrders: invoiceChangeOrders,
      });
    } catch (error) {
      console.error("Get invoice error:", error);
      res.status(500).json({ error: "Failed to get invoice" });
    }
  });

  const createInvoiceInputSchema = insertInvoiceSchema
    .pick({ clientId: true, jobId: true, taxRate: true, dueDate: true, notes: true, termsAndConditions: true })
    .extend({
      lineItems: z.array(z.object({
        category: z.string(),
        description: z.string(),
        quantity: z.union([z.string(), z.number()]),
        unit: z.string(),
        rate: z.union([z.string(), z.number()]),
        amount: z.union([z.string(), z.number()]).optional(),
        isChangeOrder: z.boolean().optional(),
        changeOrderReason: z.string().optional().nullable(),
        section: z.string().optional().nullable(),
        refs: z.string().optional().nullable(),
      }).superRefine((item, ctx) => {
        if (item.amount !== undefined) {
          const qty = parseFloat(String(item.quantity));
          const rate = parseFloat(String(item.rate));
          const amount = parseFloat(String(item.amount));
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
      })).optional(),
      send: z.boolean().optional(),
    });

  // Lazy-load multer to avoid Vite SSR hoisting issues in tests
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const multerLib = _require("multer") as typeof import("multer").default;
  const upload = multerLib({
    storage: multerLib.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = /^(application\/pdf|image\/(jpeg|png|webp|gif))$/.test(file.mimetype);
      cb(null, ok);
    },
  });

  app.post("/api/invoices/parse-document", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded. Accepted types: PDF, JPEG, PNG, WebP." });
      }

      let text = "";

      if (req.file.mimetype === "application/pdf") {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
        // pdf-parse v2 API: new PDFParse({ data: buffer }) then .getText()
        const { PDFParse } = _require("pdf-parse") as { PDFParse: new (opts: { data: Buffer }) => { getText: () => Promise<{ text: string }> } };
        const parser = new PDFParse({ data: req.file.buffer });
        const parsed = await parser.getText();
        text = parsed.text;
      } else {
        return res.status(400).json({ error: "Image OCR not yet supported. Please upload a PDF." });
      }

      if (!text.trim()) {
        return res.json({ lineItems: [], confidence: "low", message: "No readable text found in document." });
      }

      const result = parseDocumentText(text);
      res.json(result);
    } catch (error) {
      console.error("Document parse error:", error);
      res.status(500).json({ error: "Failed to parse document" });
    }
  });

  app.post("/api/invoices", async (req, res) => {
    try {
      const inputParsed = createInvoiceInputSchema.safeParse(req.body);
      if (!inputParsed.success) return badRequest(res, inputParsed.error);
      const { lineItems: items, send, ...invoiceData } = inputParsed.data;
      
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
        issueDate: new Date(),
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
            section: item.section || null,
            refs: item.refs || null,
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

  app.patch("/api/invoices/:id", async (req, res) => {
    try {
      const parsed = insertInvoiceSchema.partial().safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const existing = await storage.getInvoice(req.params.id);
      if (!existing) return res.status(404).json({ error: "Invoice not found" });
      if (existing.status === "paid") {
        return res.status(400).json({ error: "Paid invoices cannot be edited" });
      }
      await storage.updateInvoice(req.params.id, parsed.data);
      if ("taxRate" in parsed.data) await recalcInvoiceTotals(req.params.id);
      const invoice = await storage.getInvoice(req.params.id);
      res.json(invoice);
    } catch (error) {
      console.error("Update invoice error:", error);
      res.status(500).json({ error: "Failed to update invoice" });
    }
  });

  app.delete("/api/invoices/:id", async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      await storage.deleteInvoice(req.params.id);
      res.status(204).end();
    } catch (error) {
      console.error("Delete invoice error:", error);
      res.status(500).json({ error: "Failed to delete invoice" });
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

  app.post("/api/invoices/:id/send-change-order", async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });

      const client = await storage.getClient(invoice.clientId);
      if (!client?.email) {
        return res.status(400).json({ error: "Client has no email address on file" });
      }
      if (!process.env.RESEND_API_KEY) {
        return res.status(500).json({ error: "Email service is not configured" });
      }

      const result = await sendChangeOrderEmail(req.params.id, client.email, {
        apiKey: process.env.RESEND_API_KEY,
        provider: "resend",
      });

      if (!result.success) {
        return res.status(502).json({ error: result.error || "Failed to send email" });
      }

      res.json({ success: true, sentTo: client.email });
    } catch (error) {
      console.error("Send change order email error:", error);
      res.status(500).json({ error: "Failed to send change order email" });
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

      const paymentMethod = req.body.paymentMethod || "cash";
      const paymentDate = req.body.paymentDate ? new Date(req.body.paymentDate) : new Date();
      const balance = Number(invoice.balance ?? invoice.total);

      // Only create a payment record if there is still a balance owed
      if (balance > 0) {
        await storage.createPayment({
          invoiceId: invoice.id,
          amount: String(balance),
          paymentMethod,
          paymentDate,
          referenceNumber: req.body.referenceNumber || null,
          notes: req.body.notes || null,
        });
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

  // Change Orders
  app.get("/api/invoices/:id/change-orders", async (req, res) => {
    try {
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      const orders = await storage.getChangeOrdersByInvoice(req.params.id);
      res.json(orders);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch change orders" });
    }
  });

  app.post("/api/invoices/:id/change-orders", async (req, res) => {
    try {
      const parsed = insertChangeOrderSchema.safeParse({ ...req.body, invoiceId: req.params.id });
      if (!parsed.success) return badRequest(res, parsed.error);
      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      const order = await storage.createChangeOrder(parsed.data);
      res.status(201).json(order);
    } catch (error) {
      res.status(500).json({ error: "Failed to create change order" });
    }
  });

  app.patch("/api/change-orders/:id", async (req, res) => {
    try {
      const order = await storage.getChangeOrder(req.params.id);
      if (!order) return res.status(404).json({ error: "Change order not found" });
      const parsed = insertChangeOrderSchema.partial().safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const updated = await storage.updateChangeOrder(req.params.id, parsed.data);
      await recalcInvoiceTotals(order.invoiceId);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update change order" });
    }
  });

  app.delete("/api/change-orders/:id", async (req, res) => {
    try {
      const order = await storage.getChangeOrder(req.params.id);
      if (!order) return res.status(404).json({ error: "Change order not found" });
      await storage.deleteChangeOrder(req.params.id);
      await recalcInvoiceTotals(order.invoiceId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete change order" });
    }
  });

  app.post("/api/invoices/:id/payments", async (req, res) => {
    try {
      const parsed = insertPaymentSchema.safeParse({ ...req.body, invoiceId: req.params.id });
      if (!parsed.success) return badRequest(res, parsed.error);

      const invoice = await storage.getInvoice(req.params.id);
      if (!invoice) {
        return res.status(404).json({ error: "Invoice not found" });
      }

      const payment = await storage.createPayment(parsed.data);

      const newAmountPaid = Number(invoice.amountPaid) + Number(parsed.data.amount);
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
          const [entries, deductions, onboarding] = await Promise.all([
            storage.getTimeEntriesByEmployee(employee.id),
            storage.getDeductionsByEmployee(employee.id),
            storage.getOnboardingItems(employee.id),
          ]);
          const periodEntries = entries.filter((entry) => {
            const entryDate = new Date(entry.date);
            return entryDate >= startOfPeriod && entryDate <= endOfPeriod;
          });
          
          const hoursThisPeriod = periodEntries.reduce(
            (sum, entry) => sum + Number(entry.hoursWorked),
            0
          );
          const totalPay = hoursThisPeriod * Number(employee.dayRate);
          const onboardingIncomplete = employee.status === "active" && onboarding.some(item => !item.completed);
          
          return { ...employee, hoursThisPeriod, totalPay, deductions, deductionsCount: deductions.length, onboardingIncomplete };
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
      const parsed = insertEmployeeSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const employee = await storage.createEmployee(parsed.data);
      await storage.seedDefaultOnboardingItems(employee.id);
      res.status(201).json(employee);
    } catch (error) {
      console.error("Create employee error:", error);
      res.status(500).json({ error: "Failed to create employee" });
    }
  });

  app.patch("/api/employees/:id", async (req, res) => {
    try {
      const parsed = insertEmployeeSchema.partial().safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const employee = await storage.updateEmployee(req.params.id, parsed.data);
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

  // Employee Assignments
  app.get("/api/jobs/:id/assignments", async (req, res) => {
    try {
      const assignments = await storage.getAssignmentsByJob(req.params.id);
      res.json(assignments);
    } catch (error) {
      console.error("Get assignments error:", error);
      res.status(500).json({ error: "Failed to get assignments" });
    }
  });

  app.put("/api/jobs/:id/assignments", async (req, res) => {
    try {
      const { employeeIds } = req.body;
      if (!Array.isArray(employeeIds)) {
        return res.status(400).json({ error: "employeeIds must be an array" });
      }
      await storage.setJobAssignments(req.params.id, employeeIds);
      const assignments = await storage.getAssignmentsByJob(req.params.id);
      res.json(assignments);
    } catch (error) {
      console.error("Set assignments error:", error);
      res.status(500).json({ error: "Failed to update assignments" });
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
      const parsed = insertTimeEntrySchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);

      const { employeeId, date, hoursWorked } = parsed.data;
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      const employeeEntries = await storage.getTimeEntriesByEmployee(employeeId);
      const sameDayEntries = employeeEntries.filter((e) => {
        const entryDate = new Date(e.date);
        return entryDate >= dayStart && entryDate <= dayEnd;
      });

      const existingTotal = sameDayEntries.reduce((sum, e) => sum + parseFloat(e.hoursWorked), 0);
      const newHours = parseFloat(String(hoursWorked));
      const newTotal = existingTotal + newHours;

      if (newTotal > 24) {
        return res.status(400).json({
          error: `This entry would bring the daily total to ${newTotal.toFixed(2)} hours for this employee, exceeding the 24-hour limit. They already have ${existingTotal.toFixed(2)} hours logged on this date.`,
        });
      }

      const entry = await storage.createTimeEntry(parsed.data);
      res.status(201).json(entry);
    } catch (error) {
      console.error("Create time entry error:", error);
      res.status(500).json({ error: "Failed to create time entry" });
    }
  });

  app.delete("/api/time-entries/:id", async (req, res) => {
    try {
      await storage.deleteTimeEntry(req.params.id);
      res.status(204).send();
    } catch (error) {
      console.error("Delete time entry error:", error);
      res.status(500).json({ error: "Failed to delete time entry" });
    }
  });

  // Payroll Records
  app.get("/api/payroll-records", async (req, res) => {
    try {
      const records = await storage.getPayrollRecords();
      const enriched = await Promise.all(
        records.map(async (r) => {
          const employee = await storage.getEmployee(r.employeeId);
          return { ...r, employee };
        })
      );
      res.json(enriched);
    } catch (error) {
      console.error("Get payroll records error:", error);
      res.status(500).json({ error: "Failed to get payroll records" });
    }
  });

  // ── Payroll Settings ─────────────────────────────────────────────────────
  app.get("/api/payroll-settings", requireAuth, async (_req, res) => {
    try {
      let ps = await storage.getPayrollSettings();
      if (!ps) ps = await storage.upsertPayrollSettings({ payFrequency: "biweekly" });
      res.json(ps);
    } catch (err) {
      res.status(500).json({ error: "Failed to get payroll settings" });
    }
  });

  app.patch("/api/payroll-settings", requireAuth, async (req, res) => {
    try {
      const freq = req.body?.payFrequency;
      const allowed = ["weekly","biweekly","semimonthly","monthly"];
      if (freq && !allowed.includes(freq)) return res.status(400).json({ error: "Invalid payFrequency" });
      const ps = await storage.upsertPayrollSettings(freq ? { payFrequency: freq } : {});
      res.json(ps);
    } catch (err) {
      res.status(500).json({ error: "Failed to update payroll settings" });
    }
  });

  // ── Employee Deductions ───────────────────────────────────────────────────
  app.get("/api/employees/:id/deductions", requireAuth, async (req, res) => {
    try {
      const deductions = await storage.getDeductionsByEmployee(req.params.id);
      res.json(deductions);
    } catch (err) {
      res.status(500).json({ error: "Failed to get deductions" });
    }
  });

  app.post("/api/employees/:id/deductions", requireAuth, async (req, res) => {
    try {
      const { label, deductionType, amount, category, active } = req.body;
      if (!label || !amount) return res.status(400).json({ error: "label and amount are required" });
      const deduction = await storage.createDeduction({
        employeeId: req.params.id,
        label,
        deductionType: deductionType ?? "fixed",
        amount: String(amount),
        category: category ?? "other",
        active: active !== false,
      });
      res.status(201).json(deduction);
    } catch (err) {
      res.status(500).json({ error: "Failed to create deduction" });
    }
  });

  app.patch("/api/employees/:empId/deductions/:id", requireAuth, async (req, res) => {
    try {
      const updates: Record<string, unknown> = {};
      const allowed = ["label","deductionType","amount","category","active"];
      allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
      if (updates.amount) updates.amount = String(updates.amount);
      const d = await storage.updateDeduction(req.params.id, updates as any);
      if (!d) return res.status(404).json({ error: "Deduction not found" });
      res.json(d);
    } catch (err) {
      res.status(500).json({ error: "Failed to update deduction" });
    }
  });

  app.delete("/api/employees/:empId/deductions/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteDeduction(req.params.id);
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: "Failed to delete deduction" });
    }
  });

  // ── Employee Onboarding Items ──────────────────────────────────────────────
  app.get("/api/employees/:id/onboarding", requireAuth, async (req, res) => {
    try {
      const items = await storage.getOnboardingItems(req.params.id);
      res.json(items);
    } catch (err) {
      res.status(500).json({ error: "Failed to get onboarding items" });
    }
  });

  app.post("/api/employees/:id/onboarding", requireAuth, async (req, res) => {
    try {
      const { label } = req.body;
      if (!label || typeof label !== "string" || !label.trim()) {
        return res.status(400).json({ error: "label is required" });
      }
      const existing = await storage.getOnboardingItems(req.params.id);
      const item = await storage.upsertOnboardingItem({
        employeeId: req.params.id,
        label: label.trim(),
        completed: false,
        completedDate: null,
        sortOrder: existing.length,
      });
      res.status(201).json(item);
    } catch (err) {
      res.status(500).json({ error: "Failed to create onboarding item" });
    }
  });

  app.patch("/api/employees/:empId/onboarding/:id", requireAuth, async (req, res) => {
    try {
      const { completed, label } = req.body;
      const updates: Partial<{ label: string; completed: boolean; completedDate: Date | null }> = {};
      if (label !== undefined) updates.label = String(label);
      if (completed !== undefined) {
        updates.completed = !!completed;
        updates.completedDate = completed ? new Date() : null;
      }
      const item = await storage.updateOnboardingItem(req.params.id, req.params.empId, updates);
      if (!item) return res.status(404).json({ error: "Onboarding item not found" });
      res.json(item);
    } catch (err) {
      res.status(500).json({ error: "Failed to update onboarding item" });
    }
  });

  app.delete("/api/employees/:empId/onboarding/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteOnboardingItem(req.params.id, req.params.empId);
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: "Failed to delete onboarding item" });
    }
  });

  // ── Flat deduction aliases (PATCH/DELETE /api/employee-deductions/:id) ────
  app.patch("/api/employee-deductions/:id", requireAuth, async (req, res) => {
    try {
      const updates: Record<string, unknown> = {};
      const allowed = ["label","deductionType","amount","category","active"];
      allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
      if (updates.amount) updates.amount = String(updates.amount);
      const d = await storage.updateDeduction(req.params.id, updates as any);
      if (!d) return res.status(404).json({ error: "Deduction not found" });
      res.json(d);
    } catch (err) {
      res.status(500).json({ error: "Failed to update deduction" });
    }
  });

  app.delete("/api/employee-deductions/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteDeduction(req.params.id);
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ error: "Failed to delete deduction" });
    }
  });

  // ── Tax-withholding helper ────────────────────────────────────────────────
  function calcFederalTax(annualGross: number, filingStatus: string): number {
    const stdDeduction = filingStatus === "married" ? 29200 : filingStatus === "head_of_household" ? 21900 : 14600;
    const taxable = Math.max(0, annualGross - stdDeduction);
    let tax = 0;
    if (filingStatus === "married") {
      const brackets = [[0,23200,.10],[23200,94300,.12],[94300,201050,.22],[201050,383900,.24],[383900,487450,.32],[487450,731200,.35],[731200,Infinity,.37]];
      for (const [lo, hi, r] of brackets) {
        if (taxable <= lo) break;
        tax += (Math.min(taxable, hi as number) - lo) * r;
      }
    } else {
      const brackets = [[0,11600,.10],[11600,47150,.12],[47150,100525,.22],[100525,191950,.24],[191950,243725,.32],[243725,609350,.35],[609350,Infinity,.37]];
      for (const [lo, hi, r] of brackets) {
        if (taxable <= lo) break;
        tax += (Math.min(taxable, hi as number) - lo) * r;
      }
    }
    return tax;
  }

  const STATE_RATES: Record<string,number> = {
    TX:0, FL:0, WA:0, NV:0, WY:0, SD:0, AK:0, TN:0, NH:0,
    CA:.093, NY:.0685, OR:.099, MN:.0985, HI:.11,
    MA:.05, IL:.0495, CO:.044, PA:.0307, MI:.0425, GA:.055,
  };

  function calcStateTax(annualGross: number, stateCode: string): number {
    const rate = STATE_RATES[stateCode?.toUpperCase()] ?? 0.05;
    return annualGross * rate;
  }

  // Compute per-period OT breakdown by ISO work week (Mon–Sun)
  function computeOvertimeBreakdown(entries: { date: string | Date; hoursWorked: string | number }[], dayRate: number) {
    const byWeek = new Map<string, number>();
    for (const e of entries) {
      const d = new Date(e.date);
      const day = d.getUTCDay(); // 0=Sun,1=Mon,...
      const mondayOffset = (day === 0 ? -6 : 1 - day);
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() + mondayOffset);
      const weekKey = monday.toISOString().slice(0,10);
      byWeek.set(weekKey, (byWeek.get(weekKey) ?? 0) + Number(e.hoursWorked));
    }
    let regularHours = 0, overtimeHours = 0;
    for (const wkHours of byWeek.values()) {
      regularHours += Math.min(wkHours, 40);
      overtimeHours += Math.max(0, wkHours - 40);
    }
    const regularPay = regularHours * dayRate;
    const overtimePay = overtimeHours * dayRate * 1.5;
    const grossPay = regularPay + overtimePay;
    return { regularHours, overtimeHours, regularPay, overtimePay, grossPay };
  }

  // Run payroll for a date range — creates one record per active employee
  app.post("/api/payroll-records/run", async (req, res) => {
    try {
      const { periodStart, periodEnd } = req.body;
      if (!periodStart || !periodEnd) {
        return res.status(400).json({ error: "periodStart and periodEnd are required" });
      }
      const start = new Date(periodStart);
      const end = new Date(periodEnd);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
        return res.status(400).json({ error: "Invalid date range" });
      }

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (start > today) {
        return res.status(400).json({ error: "periodStart cannot be in the future" });
      }

      const existingRecords = await storage.getPayrollRecords();
      const overlap = existingRecords.find((r) => {
        const rStart = new Date(r.periodStart);
        const rEnd = new Date(r.periodEnd);
        return rStart < end && rEnd > start;
      });
      if (overlap) {
        return res.status(400).json({ error: "This period overlaps with an already-processed payroll period" });
      }

      const activeEmployees = (await storage.getEmployees()).filter((e) => e.status === "active");
      const periodEntries = await storage.getTimeEntriesByPeriod(start, end);
      const periodDays = Math.max(1, (end.getTime() - start.getTime()) / 864e5);

      const created = await Promise.all(
        activeEmployees
          .map(async (emp) => {
            const empEntries = periodEntries.filter((e) => e.employeeId === emp.id);
            const dayRate = Number(emp.dayRate);
            const isSalary = emp.payType === "salary";
            const is1099 = emp.employmentType === "1099";

            // ── Hours and gross pay ──
            let grossPay: number, regularHours: number, overtimeHours: number, regularPay: number, overtimePay: number, totalHours: number;
            if (isSalary) {
              const annual = Number(emp.annualSalary ?? 0);
              grossPay = annual * (periodDays / 365);
              totalHours = empEntries.reduce((s, e) => s + Number(e.hoursWorked), 0);
              regularHours = totalHours; overtimeHours = 0; regularPay = grossPay; overtimePay = 0;
            } else {
              const ot = computeOvertimeBreakdown(empEntries as any, dayRate);
              ({ regularHours, overtimeHours, regularPay, overtimePay, grossPay } = ot);
              totalHours = regularHours + overtimeHours;
            }

            if (totalHours === 0 && !isSalary) return null;

            // ── Deductions ──
            const empDeductions = await storage.getDeductionsByEmployee(emp.id);
            const activeDeductions = empDeductions.filter(d => d.active);
            const deductionsBreakdown: { label: string; amount: number; category: string }[] = [];
            let totalDeductionAmount = 0;
            for (const d of activeDeductions) {
              const amt = d.deductionType === "percent"
                ? grossPay * (Number(d.amount) / 100)
                : Number(d.amount);
              deductionsBreakdown.push({ label: d.label, amount: amt, category: d.category });
              totalDeductionAmount += amt;
            }

            // ── Tax withholding (W-2 only) ──
            let taxWithheld = 0;
            if (!is1099) {
              const allowanceValue = 4300 * (emp.taxAllowances ?? 0);
              const annualGross = grossPay * (365 / periodDays);
              const adjustedAnnual = Math.max(0, annualGross - allowanceValue);
              const annualFederal = calcFederalTax(adjustedAnnual, emp.filingStatus ?? "single");
              const annualState = calcStateTax(adjustedAnnual, emp.stateCode ?? "CA");
              const annualTax = annualFederal + annualState;
              taxWithheld = Math.max(0, annualTax * (periodDays / 365));
            }

            const netPay = Math.max(0, grossPay - totalDeductionAmount - taxWithheld);

            return storage.createPayrollRecord({
              employeeId: emp.id,
              periodStart: start,
              periodEnd: end,
              totalHours: String(totalHours),
              regularHours: String(regularHours),
              overtimeHours: String(overtimeHours),
              dayRate: String(dayRate),
              regularPay: String(regularPay),
              overtimePay: String(overtimePay),
              grossPay: String(grossPay),
              taxWithheld: String(taxWithheld),
              deductions: String(totalDeductionAmount),
              deductionsBreakdown,
              netPay: String(netPay),
              status: "pending",
            });
          })
          .filter(Boolean)
      );

      const results = (await Promise.all(created)).filter(Boolean);
      res.status(201).json(results);
    } catch (error) {
      console.error("Run payroll error:", error);
      res.status(500).json({ error: "Failed to run payroll" });
    }
  });

  app.patch("/api/payroll-records/:id", async (req, res) => {
    try {
      const parsed = insertPayrollRecordSchema.partial().safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const updates: Record<string, unknown> = {};
      if (req.body.status) updates.status = req.body.status;
      if (req.body.status === "paid") updates.paidDate = new Date();
      const record = await storage.updatePayrollRecord(req.params.id, updates as Parameters<typeof storage.updatePayrollRecord>[1]);
      if (!record) return res.status(404).json({ error: "Payroll record not found" });
      res.json(record);
    } catch (error) {
      console.error("Update payroll record error:", error);
      res.status(500).json({ error: "Failed to update payroll record" });
    }
  });

  app.delete("/api/payroll-records/:id", async (req, res) => {
    try {
      await storage.updatePayrollRecord(req.params.id, { status: "pending" });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete payroll record" });
    }
  });

  // Invites (admin only)
  app.get("/api/invites", async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.isAdmin) return res.status(403).json({ error: "Admin access required" });
      const all = await storage.getInvites();
      res.json(all);
    } catch (error) {
      res.status(500).json({ error: "Failed to get invites" });
    }
  });

  app.post("/api/invites", async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.isAdmin) return res.status(403).json({ error: "Admin access required" });
      const { label } = req.body;
      const code = Array.from({ length: 8 }, () =>
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]
      ).join("");
      const invite = await storage.createInvite(code, label || undefined);
      res.status(201).json(invite);
    } catch (error) {
      res.status(500).json({ error: "Failed to create invite" });
    }
  });

  app.delete("/api/invites/:id", async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user?.isAdmin) return res.status(403).json({ error: "Admin access required" });
      await storage.deleteInvite(req.params.id);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete invite" });
    }
  });

  // ── Inbox (Gmail) ─────────────────────────────────────────────────────────
  //
  // Security model: Gmail is connected at the Replit project level (one OAuth
  // token per Repl). Access to sync is therefore restricted to admin users only
  // so that the connected mailbox is never exposed to non-admin accounts.

  function requireAdmin(req: Request, res: Response, next: NextFunction) {
    storage.getUser(req.session.userId!).then((user) => {
      if (!user?.isAdmin) return res.status(403).json({ error: "Admin access required" });
      next();
    }).catch(() => res.status(500).json({ error: "Auth check failed" }));
  }

  // ── Per-user Gmail OAuth ──────────────────────────────────────────────────

  // Redirect user's browser to Google OAuth consent screen
  app.get("/api/gmail/auth", requireAuth, (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return res.status(503).json({ error: "Google OAuth not configured" });
    }
    const crypto = require("crypto") as typeof import("crypto");
    const state = crypto.randomBytes(16).toString("hex");
    req.session.gmailOAuthState = state;
    try {
      const authUrl = buildGmailAuthUrl(state);
      res.redirect(authUrl);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Google redirects here after user consents
  app.get("/api/gmail/callback", async (req, res) => {
    const { code, state, error } = req.query as Record<string, string>;
    const baseUrl = (process.env.APP_URL || "http://localhost:5000").replace(/\/$/, "");

    if (error) {
      return res.redirect(`${baseUrl}/inbox-tasks?gmail_error=${encodeURIComponent(error)}`);
    }

    // CSRF check — state must match what we stored in session
    if (!req.session.userId) {
      return res.redirect(`${baseUrl}/login?error=session_expired`);
    }
    if (!state || state !== req.session.gmailOAuthState) {
      return res.redirect(`${baseUrl}/inbox-tasks?gmail_error=invalid_state`);
    }
    delete req.session.gmailOAuthState;

    try {
      const tokens = await exchangeGmailCode(code);
      await storage.saveGoogleToken(req.session.userId, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        gmailEmail: tokens.email,
      });
      res.redirect(`${baseUrl}/inbox-tasks?gmail_connected=1`);
    } catch (err: any) {
      console.error("Gmail OAuth callback error:", err);
      res.redirect(`${baseUrl}/inbox-tasks?gmail_error=${encodeURIComponent(err.message)}`);
    }
  });

  // Per-user Gmail connection status — returns { connected, email }
  app.get("/api/gmail/status", requireAuth, async (req, res) => {
    try {
      const connected = await isUserGmailConnected(req.session.userId!);
      const email = connected ? await getUserGmailEmail(req.session.userId!) : null;
      res.json({ connected, email });
    } catch {
      res.json({ connected: false, email: null });
    }
  });

  // Available Gmail labels for the connected user
  app.get("/api/gmail/labels", requireAuth, async (req, res) => {
    try {
      const labels = await fetchGmailLabelsForUser(req.session.userId!);
      res.json(labels);
    } catch (err) {
      const msg = String(err);
      if (msg.includes("not connected") || msg.includes("expired")) {
        return res.status(401).json({ error: "Gmail not connected", code: "NOT_CONNECTED" });
      }
      console.error("Gmail labels error:", err);
      res.status(500).json({ error: "Failed to fetch Gmail labels" });
    }
  });

  // Get the user's current label filter selection
  app.get("/api/gmail/sync-labels", requireAuth, async (req, res) => {
    try {
      const labels = await storage.getSyncLabels(req.session.userId!);
      res.json({ labels });
    } catch (err) {
      res.status(500).json({ error: "Failed to read sync labels" });
    }
  });

  // Save the user's label filter selection
  app.patch("/api/gmail/sync-labels", requireAuth, async (req, res) => {
    const { labels } = req.body as { labels?: unknown };
    if (!Array.isArray(labels) || labels.length === 0 || labels.some((l) => typeof l !== "string")) {
      return res.status(400).json({ error: "labels must be a non-empty array of strings" });
    }
    try {
      await storage.saveSyncLabels(req.session.userId!, labels as string[]);
      res.json({ labels });
    } catch (err) {
      console.error("Save sync labels error:", err);
      res.status(500).json({ error: "Failed to save sync labels" });
    }
  });

  // Disconnect — revokes the Google OAuth grant and clears the user's inbox cache
  app.delete("/api/gmail/disconnect", requireAuth, async (req, res) => {
    try {
      await revokeUserGmailToken(req.session.userId!);
      await storage.deleteUserInboxTasks(req.session.userId!);
      res.json({ disconnected: true });
    } catch (err) {
      console.error("Gmail disconnect error:", err);
      res.status(500).json({ error: "Failed to disconnect Gmail" });
    }
  });

  // Connection status — any authenticated user can check (display the badge)
  app.get("/api/inbox/status", requireAuth, async (req, res) => {
    try {
      const connected = await isUserGmailConnected(req.session.userId!);
      const email = connected ? await getUserGmailEmail(req.session.userId!) : null;
      res.json({ connected, email });
    } catch {
      res.json({ connected: false, email: null });
    }
  });

  // Last auto-sync timestamp — any authenticated user can read this
  app.get("/api/inbox/last-sync", async (req, res) => {
    try {
      const t = await getLastInboxSyncTime();
      res.json({ lastSyncedAt: t ? t.toISOString() : null });
    } catch {
      res.json({ lastSyncedAt: null });
    }
  });

  // Initiate Gmail OAuth — returns the connector authorize URL for the frontend
  // to open in a new tab. This is the runtime equivalent of proposeIntegration:
  // the Replit connector proxy handles the Google OAuth handshake and stores
  // the resulting tokens, after which isGmailConnected() returns true.
  app.get("/api/inbox/connect", requireAdmin, async (req, res) => {
    const authUrl = getGmailOAuthUrl();
    if (!authUrl) {
      return res.status(503).json({
        error: "Replit connector infrastructure not available in this environment. " +
               "Connect Gmail from the Replit integrations panel (puzzle-piece icon) instead.",
        code: "NO_CONNECTOR_HOST",
      });
    }
    res.json({ authUrl });
  });

  // Disconnect — revokes the OAuth token via the Replit connector proxy AND
  // clears all cached inbox tasks. After this, isGmailConnected() returns false.
  app.post("/api/inbox/disconnect", requireAdmin, async (req, res) => {
    try {
      const revoked = await revokeGmailConnection();
      await storage.deleteUserInboxTasks(req.session.userId!);
      res.json({ disconnected: true, revoked });
    } catch (error) {
      console.error("Inbox disconnect error:", error);
      res.status(500).json({ error: "Failed to disconnect inbox" });
    }
  });

  // Return cached inbox tasks for the requesting user
  app.get("/api/inbox/tasks", async (req, res) => {
    try {
      const tasks = await storage.getInboxTasks(req.session.userId!);
      res.json(tasks);
    } catch (error) {
      console.error("Get inbox tasks error:", error);
      res.status(500).json({ error: "Failed to get inbox tasks" });
    }
  });

  // GET /api/inbox/messages — fetches the user's live last-50 inbox emails
  // using their personal Gmail token, upserts into cache, returns task list.
  app.get("/api/inbox/messages", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    try {
      const messages = await fetchUserGmailInbox(userId, 50);
      await Promise.all(
        messages.map((m) =>
          storage.upsertInboxTask({
            userId,
            emailId: m.id,
            subject: m.subject,
            sender: m.sender,
            senderEmail: m.senderEmail ?? null,
            snippet: m.snippet ?? null,
            receivedAt: m.receivedAt,
            isRead: m.isRead,
            isDone: false,
          })
        )
      );
      const tasks = await storage.getInboxTasks(userId);
      res.json(tasks);
    } catch (error: any) {
      const msg = error?.message ?? "";
      if (msg.includes("not connected") || msg.includes("expired")) {
        try {
          const cached = await storage.getInboxTasks(userId);
          return res.json(cached);
        } catch {
          return res.status(503).json({ error: "Gmail not connected", code: "NOT_CONNECTED" });
        }
      }
      console.error("inbox/messages error:", error);
      res.status(500).json({ error: "Failed to fetch inbox messages" });
    }
  });

  // POST /api/inbox/sync — syncs the user's Gmail inbox into their cache
  app.post("/api/inbox/sync", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    try {
      const messages = await fetchUserGmailInbox(userId, 50);
      await Promise.all(
        messages.map((m) =>
          storage.upsertInboxTask({
            userId,
            emailId: m.id,
            subject: m.subject,
            sender: m.sender,
            senderEmail: m.senderEmail ?? null,
            snippet: m.snippet ?? null,
            receivedAt: m.receivedAt,
            isRead: m.isRead,
            isDone: false,
          })
        )
      );
      const tasks = await storage.getInboxTasks(userId);
      res.json(tasks);
    } catch (error: any) {
      const msg = error?.message ?? "Failed to sync Gmail";
      if (msg.includes("not connected")) {
        return res.status(503).json({ error: "Gmail not connected", code: "NOT_CONNECTED" });
      }
      if (msg.includes("expired")) {
        return res.status(401).json({ error: msg, code: "TOKEN_EXPIRED" });
      }
      console.error("Gmail sync error:", error);
      res.status(500).json({ error: msg });
    }
  });

  // POST /api/inbox/sync/all — admin-only: run the full inbox sync immediately for all connected users
  app.post("/api/inbox/sync/all", requireAdmin, async (req, res) => {
    try {
      await syncInboxForConnectedUsers();
      const lastSync = await getLastInboxSyncTime();
      res.json({ ok: true, lastInboxSync: lastSync });
    } catch (error: any) {
      console.error("Admin inbox sync error:", error);
      res.status(500).json({ error: error?.message ?? "Sync failed" });
    }
  });

  // Toggle done — scoped to requesting user's own tasks (any authenticated user)
  app.patch("/api/inbox/tasks/:emailId/done", async (req, res) => {
    try {
      const { isDone } = req.body;
      if (typeof isDone !== "boolean") {
        return res.status(400).json({ error: "isDone (boolean) is required" });
      }
      const task = await storage.markInboxTaskDone(req.session.userId!, req.params.emailId, isDone);
      if (!task) return res.status(404).json({ error: "Task not found" });
      res.json(task);
    } catch (error) {
      console.error("Toggle inbox task error:", error);
      res.status(500).json({ error: "Failed to update task" });
    }
  });

  // Dismiss — permanently removes task from list for this user
  app.patch("/api/inbox/tasks/:emailId/dismiss", async (req, res) => {
    try {
      const task = await storage.dismissInboxTask(req.session.userId!, req.params.emailId);
      if (!task) return res.status(404).json({ error: "Task not found" });
      res.json(task);
    } catch (error) {
      console.error("Dismiss inbox task error:", error);
      res.status(500).json({ error: "Failed to dismiss task" });
    }
  });

  // Snooze — hides task until a given date (or tomorrow by default)
  app.patch("/api/inbox/tasks/:emailId/snooze", async (req, res) => {
    try {
      let snoozeUntil: Date;
      if (req.body?.until) {
        snoozeUntil = new Date(req.body.until);
        if (isNaN(snoozeUntil.getTime())) {
          return res.status(400).json({ error: "Invalid 'until' date" });
        }
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        if (snoozeUntil <= startOfToday) {
          return res.status(400).json({ error: "'until' date must be in the future" });
        }
      } else {
        snoozeUntil = new Date();
        snoozeUntil.setDate(snoozeUntil.getDate() + 1);
        snoozeUntil.setHours(0, 0, 0, 0);
      }
      const task = await storage.snoozeInboxTask(req.session.userId!, req.params.emailId, snoozeUntil);
      if (!task) return res.status(404).json({ error: "Task not found" });
      res.json(task);
    } catch (error) {
      console.error("Snooze inbox task error:", error);
      res.status(500).json({ error: "Failed to snooze task" });
    }
  });

  // Hidden inbox tasks — dismissed or currently snoozed
  app.get("/api/inbox/tasks/hidden", async (req, res) => {
    try {
      const tasks = await storage.getHiddenInboxTasks(req.session.userId!);
      res.json(tasks);
    } catch (error) {
      console.error("Get hidden inbox tasks error:", error);
      res.status(500).json({ error: "Failed to get hidden tasks" });
    }
  });

  // Restore — clears dismissed=true and/or snoozedUntil for this user's task
  app.patch("/api/inbox/tasks/:emailId/restore", async (req, res) => {
    try {
      const task = await storage.restoreInboxTask(req.session.userId!, req.params.emailId);
      if (!task) return res.status(404).json({ error: "Task not found" });
      res.json(task);
    } catch (error) {
      console.error("Restore inbox task error:", error);
      res.status(500).json({ error: "Failed to restore task" });
    }
  });

  app.delete("/api/inbox/tasks/bulk", requireAuth, async (req, res) => {
    try {
      const parsed = z.object({ emailIds: z.array(z.string()).min(1) }).safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      await storage.deleteManyInboxTasks(req.session.userId!, parsed.data.emailIds);
      res.status(204).end();
    } catch (error) {
      console.error("Bulk delete inbox tasks error:", error);
      res.status(500).json({ error: "Failed to delete tasks" });
    }
  });

  app.delete("/api/inbox/tasks/dismissed", requireAuth, async (req, res) => {
    try {
      await storage.deleteAllDismissedInboxTasks(req.session.userId!);
      res.status(204).end();
    } catch (error) {
      console.error("Delete all dismissed inbox tasks error:", error);
      res.status(500).json({ error: "Failed to delete dismissed tasks" });
    }
  });

  app.delete("/api/inbox/tasks/:emailId", requireAuth, async (req, res) => {
    try {
      await storage.deleteInboxTask(req.session.userId!, req.params.emailId);
      res.status(204).end();
    } catch (error) {
      console.error("Delete inbox task error:", error);
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  // ── SMS config (authenticated — returns phone number for display) ────────
  app.get("/api/sms/config", async (_req, res) => {
    res.json({ phoneNumber: process.env.TWILIO_PHONE_NUMBER ?? null });
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
      const nextInboxSync = await getNextInboxSyncTime();
      const lastInboxSync = await getLastInboxSyncTime();
      res.json({ ...settings, nextInboxSync, lastInboxSync });
    } catch (error) {
      console.error("Get settings error:", error);
      res.status(500).json({ error: "Failed to get settings" });
    }
  });

  app.patch("/api/settings", requireAuth, requireAdmin, async (req, res) => {
    try {
      const parsed = insertSettingsSchema.partial().safeParse(req.body);
      if (!parsed.success) return badRequest(res, parsed.error);
      const settings = await storage.updateSettings(parsed.data);
      res.json(settings);
    } catch (error) {
      console.error("Update settings error:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  return httpServer;
}
