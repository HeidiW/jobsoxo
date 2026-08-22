import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { processOverdueReminders } from "./email";
import { startInboxScheduler } from "./scheduler";
import { seedDemoData } from "./seed";
import { validateEncryptionKey } from "./encryption";
import { migrateEncryptBankAccounts } from "./migrate-encrypt-bank-accounts";
export { log } from "./logger";
import { log } from "./logger";

declare module "express-session" {
  interface SessionData {
    userId: string;
    gmailOAuthState?: string;
    gmailReturnPath?: string;
  }
}

const app = express();
app.set("trust proxy", 1);
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Validate required secrets before touching the database.
  try {
    validateEncryptionKey();
  } catch (err: any) {
    console.error(`[startup] ${err.message}`);
    process.exit(1);
  }

  // Encrypt any bank_accounts rows that were written before encryption was added.
  try {
    await migrateEncryptBankAccounts();
  } catch (err) {
    console.error("[startup] Bank account encryption migration failed:", err);
    process.exit(1);
  }

  await registerRoutes(httpServer, app);
  await seedDemoData();

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );

  // Daily reminder scheduler — runs once at startup, then every 24 hours
  const runReminders = async () => {
    try {
      const result = await processOverdueReminders();
      log(`Reminder check: ${result.sent} sent, ${result.processed} checked, ${result.errors.length} errors`, "scheduler");
    } catch (err) {
      log(`Reminder check failed: ${err}`, "scheduler");
    }
  };
  runReminders();
  setInterval(runReminders, 24 * 60 * 60 * 1000);

  // Daily Gmail inbox auto-sync (default 08:00, configurable via INBOX_SYNC_HOUR)
  startInboxScheduler();
})();
