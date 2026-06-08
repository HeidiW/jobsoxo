import express from "express";
import session from "express-session";
import { createServer } from "http";
import { registerRoutes } from "./routes";

export async function buildTestApp() {
  const app = express();

  app.use(express.json());
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
