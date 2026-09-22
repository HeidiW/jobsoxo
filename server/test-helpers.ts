// Provide a deterministic dummy key so the encryption module works in tests
// without needing a real ENCRYPTION_KEY secret.
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = "0".repeat(64);
}

import express from "express";
import session from "express-session";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { storage } from "./storage";
import bcrypt from "bcryptjs";

export async function buildTestApp() {
  const app = express();

  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = Buffer.from(buf); } }));
  app.use(express.urlencoded({ extended: false }));

  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
    })
  );

  app.use("/api", (req, _res, next) => {
    req.session.userId = "test-user";
    next();
  });

  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);

  return app;
}

/** Builds a test app where every request is authenticated as an admin user. */
export async function buildAdminTestApp() {
  const app = express();

  app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = Buffer.from(buf); } }));
  app.use(express.urlencoded({ extended: false }));

  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: false,
    })
  );

  // Create (or reuse) a persistent admin test user in the DB.
  const adminUsername = "__test_admin__";
  let adminUser = await storage.getUserByUsername(adminUsername);
  if (!adminUser) {
    const hash = await bcrypt.hash("TestAdmin!1", 10);
    adminUser = await storage.createUser({
      username: adminUsername,
      password: hash,
      isAdmin: true,
    });
  } else if (!adminUser.isAdmin) {
    // Ensure the user is actually admin (in case it was created without the flag)
    const { db } = await import("./db");
    const { users } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, adminUser.id));
    adminUser = { ...adminUser, isAdmin: true };
  }

  const adminId = adminUser.id;

  app.use("/api", (req, _res, next) => {
    req.session.userId = adminId;
    next();
  });

  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);

  return app;
}
