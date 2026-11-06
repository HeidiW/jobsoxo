import { describe, it, expect, beforeAll, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./test-helpers";
import { db } from "./db";
import { users } from "@shared/schema";

const PASSWORD = "Setup-Code-123";
const originalCode = process.env.SETUP_CODE;
const originalEnv = process.env.NODE_ENV;

const register = (app: Express, body: Record<string, unknown>) =>
  request(app).post("/api/auth/register").send({ username: "owner@example.com", password: PASSWORD, ...body });
const userCount = async () => (await db.select().from(users)).length;

describe("first-time setup code", () => {
  let app: Express;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterEach(() => {
    if (originalCode === undefined) delete process.env.SETUP_CODE;
    else process.env.SETUP_CODE = originalCode;
    process.env.NODE_ENV = originalEnv;
  });

  it("rejects a missing or wrong code when SETUP_CODE is set", async () => {
    process.env.SETUP_CODE = "correct-horse";

    const status = await request(app).get("/api/auth/setup-status").expect(200);
    expect(status.body).toEqual({ needsSetup: true, setupCodeRequired: true });

    expect((await register(app, {}).expect(403)).body.error).toBe("Incorrect setup code");
    expect((await register(app, { setupCode: "wrong" }).expect(403)).body.error).toBe("Incorrect setup code");
    expect(await userCount()).toBe(0);
  });

  it("creates the admin with the correct code", async () => {
    process.env.SETUP_CODE = "correct-horse";

    const res = await register(app, { setupCode: " correct-horse " }).expect(201);

    expect(res.body.isAdmin).toBe(true);
    expect(await userCount()).toBe(1);
  });

  it("locks setup in production when SETUP_CODE is not set", async () => {
    delete process.env.SETUP_CODE;
    process.env.NODE_ENV = "production";

    const status = await request(app).get("/api/auth/setup-status").expect(200);
    expect(status.body.setupCodeRequired).toBe(true);

    const res = await register(app, { setupCode: "anything" }).expect(403);
    expect(res.body.error).toMatch(/Setup is locked/);
    expect(await userCount()).toBe(0);
  });

  it("needs no code in development when SETUP_CODE is not set", async () => {
    delete process.env.SETUP_CODE;
    process.env.NODE_ENV = "development";

    const status = await request(app).get("/api/auth/setup-status").expect(200);
    expect(status.body).toEqual({ needsSetup: true, setupCodeRequired: false });
    await register(app, {}).expect(201);
  });
});
