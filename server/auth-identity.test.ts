import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { buildTestApp } from "./test-helpers";
import { storage } from "./storage";

vi.mock("./email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./email")>()),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ success: true }),
}));
const { sendPasswordResetEmail } = await import("./email");

const PASSWORD = "Login-Fixes-123";
const login = (app: Express, username: unknown, password = PASSWORD) =>
  request(app).post("/api/auth/login").send({ username, password });

describe("sign-in identity", () => {
  let app: Express;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  it("first-time setup saves an email-style username as the account email", async () => {
    await request(app).post("/api/auth/register").send({ username: "  heidi@jobsoxo.com ", password: PASSWORD }).expect(201);

    const user = await storage.getUserByUsername("heidi@jobsoxo.com");
    expect(user?.email).toBe("heidi@jobsoxo.com");
  });

  it("signs in ignoring capitals and surrounding spaces", async () => {
    await storage.createUser({ username: "heidi@jobsoxo.com", password: await bcrypt.hash(PASSWORD, 4) });

    await login(app, "  Heidi@JobsOxo.com ").expect(200);
    await login(app, "heidi@jobsoxo.com", "wrong-password").expect(401);
  });

  it("prefers an exact match and refuses to guess between case variants", async () => {
    const hash = await bcrypt.hash(PASSWORD, 4);
    await storage.createUser({ username: "Bob", password: hash });
    await storage.createUser({ username: "bob", password: hash });

    expect((await login(app, "bob").expect(200)).body.username).toBe("bob");
    expect((await login(app, "Bob").expect(200)).body.username).toBe("Bob");
    await login(app, "BOB").expect(401);
  });

  it("rejects non-text usernames without a server error", async () => {
    await login(app, { $ne: "" }).expect(400);
    await request(app).post("/api/auth/forgot-password").send({ username: 42 }).expect(400);
  });

  it("sends the password reset to an email-style username from setup", async () => {
    await request(app).post("/api/auth/register").send({ username: "owner@example.com", password: PASSWORD }).expect(201);
    vi.mocked(sendPasswordResetEmail).mockClear();

    await request(app).post("/api/auth/forgot-password").send({ username: "OWNER@example.com" }).expect(200);

    expect(sendPasswordResetEmail).toHaveBeenCalledWith("owner@example.com", "owner@example.com", expect.any(String), expect.anything());
  });

  it("invite signup rejects a username that differs only by case", async () => {
    await storage.createUser({ username: "crew@example.com", password: "x" });
    await storage.createInvite("CASE1234");

    const res = await request(app).post("/api/auth/signup")
      .send({ username: "Crew@Example.com", password: PASSWORD, inviteCode: "case1234" })
      .expect(409);
    expect(res.body.error).toBe("Username already taken");
  });
});
