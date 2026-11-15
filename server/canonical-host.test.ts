import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { canonicalHostFor, canonicalHostRedirect, shouldRedirect } from "./canonical-host";

function app(appUrl: string | undefined) {
  const server = express();
  server.set("trust proxy", 1);
  server.use(canonicalHostRedirect(appUrl));
  server.get("*", (req, res) => res.json({ host: req.headers.host, path: req.originalUrl }));
  server.post("*", (req, res) => res.json({ ok: true }));
  return server;
}

describe("canonical host", () => {
  it("reads the host from APP_URL and only for https", () => {
    expect(canonicalHostFor("https://jobsoxo.app")).toBe("jobsoxo.app");
    expect(canonicalHostFor("https://JobsOxo.app/")).toBe("jobsoxo.app");
    expect(canonicalHostFor("http://localhost:5050")).toBeNull();
    expect(canonicalHostFor("not a url")).toBeNull();
    expect(canonicalHostFor(undefined)).toBeNull();
  });

  it("decides what to redirect", () => {
    expect(shouldRedirect("jobsoxo.onrender.com", "jobsoxo.app", "/invoices")).toBe(true);
    expect(shouldRedirect("www.jobsoxo.app", "jobsoxo.app", "/pay/tok")).toBe(true);
    expect(shouldRedirect("jobsoxo.app", "jobsoxo.app", "/pay/tok")).toBe(false);
    expect(shouldRedirect("localhost:5050", "jobsoxo.app", "/")).toBe(false);
    expect(shouldRedirect("jobsoxo.onrender.com", null, "/")).toBe(false);
    // A provider still pointed at the old host must keep reaching its webhook.
    expect(shouldRedirect("jobsoxo.onrender.com", "jobsoxo.app", "/api/webhooks/stripe")).toBe(false);
    expect(shouldRedirect("jobsoxo.onrender.com", "jobsoxo.app", "/api/gusto/webhook")).toBe(false);
    expect(shouldRedirect("jobsoxo.onrender.com", "jobsoxo.app", "/api/sms/inbound")).toBe(false);
  });

  it("sends old-host requests to the same path on the real domain, keeping the query", async () => {
    const res = await request(app("https://jobsoxo.app")).get("/pay/tok-1?payment=success").set("Host", "jobsoxo.onrender.com").expect(301);
    expect(res.headers.location).toBe("https://jobsoxo.app/pay/tok-1?payment=success");
    const forwarded = await request(app("https://jobsoxo.app")).get("/invoices").set("Host", "internal").set("X-Forwarded-Host", "www.jobsoxo.app").expect(301);
    expect(forwarded.headers.location).toBe("https://jobsoxo.app/invoices");
  });

  it("leaves the canonical host, webhooks and an unconfigured app alone", async () => {
    await request(app("https://jobsoxo.app")).get("/invoices").set("Host", "jobsoxo.app").expect(200);
    await request(app("https://jobsoxo.app")).post("/api/webhooks/stripe").set("Host", "jobsoxo.onrender.com").expect(200);
    await request(app(undefined)).get("/invoices").set("Host", "jobsoxo.onrender.com").expect(200);
  });
});
