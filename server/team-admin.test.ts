import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import session from "express-session";
import request from "supertest";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { storage } from "./storage";

// Each request acts as the user named in the x-test-user header.
async function buildApp(): Promise<Express> {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "team-admin-test", resave: false, saveUninitialized: false }));
  app.use("/api", (req, _res, next) => {
    const id = req.get("x-test-user");
    if (id) req.session.userId = id;
    next();
  });
  await registerRoutes(createServer(app), app);
  return app;
}

describe("team members and admin access", () => {
  let app: Express;

  beforeAll(async () => {
    app = await buildApp();
  });

  const as = (userId: string) => ({
    list: () => request(app).get("/api/users").set("x-test-user", userId),
    setAdmin: (id: string, isAdmin: unknown) =>
      request(app).patch(`/api/users/${id}/admin`).set("x-test-user", userId).send({ isAdmin }),
  });

  it("lets an admin list people and make a member an admin", async () => {
    const owner = await storage.createUser({ username: "owner@example.com", password: "x", isAdmin: true });
    const member = await storage.createUser({ username: "foyconor@gmail.com", password: "x" });

    const list = await as(owner.id).list().expect(200);
    expect(list.body.map((m: { username: string }) => m.username)).toEqual(["owner@example.com", "foyconor@gmail.com"]);
    expect(list.body[0]).not.toHaveProperty("password");

    await as(owner.id).setAdmin(member.id, true).expect(200);
    expect((await storage.getUser(member.id))?.isAdmin).toBe(true);
  });

  it("removes admin access while another admin remains", async () => {
    const owner = await storage.createUser({ username: "owner2@example.com", password: "x", isAdmin: true });
    const other = await storage.createUser({ username: "other@example.com", password: "x", isAdmin: true });

    await as(owner.id).setAdmin(other.id, false).expect(200);
    expect((await storage.getUser(other.id))?.isAdmin).toBe(false);
  });

  it("never removes the last admin", async () => {
    const owner = await storage.createUser({ username: "solo@example.com", password: "x", isAdmin: true });

    const res = await as(owner.id).setAdmin(owner.id, false).expect(409);
    expect(res.body.error).toMatch(/at least one admin/);
    expect((await storage.getUser(owner.id))?.isAdmin).toBe(true);
  });

  it("refuses members and invalid requests", async () => {
    const owner = await storage.createUser({ username: "owner3@example.com", password: "x", isAdmin: true });
    const member = await storage.createUser({ username: "member@example.com", password: "x" });

    await as(member.id).list().expect(403);
    await as(member.id).setAdmin(member.id, true).expect(403);
    expect((await storage.getUser(member.id))?.isAdmin).toBe(false);

    await as(owner.id).setAdmin(member.id, "yes").expect(400);
    await as(owner.id).setAdmin("no-such-user", true).expect(404);
  });
});
