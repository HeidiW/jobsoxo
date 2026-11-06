import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  getInvoice: vi.fn(),
  getClient: vi.fn(),
  getSettings: vi.fn(),
  insertReminderLog: vi.fn(),
  sendPaymentReminder: vi.fn(),
}));
vi.mock("./storage", () => ({ storage: mocks }));
vi.mock("./email", () => ({ sendPaymentReminder: mocks.sendPaymentReminder }));
import { sendDashboardReminder } from "./dashboard-reminders";

const app = express();
app.post("/api/invoices/:id/remind", sendDashboardReminder);

describe("Dashboard invoice reminders", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.resetAllMocks();
    // No credentials or provider calls: the actual dispatch is mocked.
    vi.stubEnv("RESEND_API_KEY", "test-only-not-a-real-key");
    mocks.getInvoice.mockResolvedValue({
      id: "invoice", clientId: "client", status: "partial", balance: "125.00",
      total: "250.00", remindersPaused: false, reminderCount: 2,
    });
    mocks.getClient.mockResolvedValue({ email: "test@example.invalid" });
    mocks.getSettings.mockResolvedValue({ reminderTones: [{ stage: 2, label: "Firm", subject: "Follow up", body: "Balance due" }] });
    mocks.sendPaymentReminder.mockResolvedValue({ success: true });
    mocks.insertReminderLog.mockResolvedValue({});
  });

  it("sends and logs a real reminder without updating financial state or automated stages", async () => {
    const response = await request(app).post("/api/invoices/invoice/remind");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(mocks.sendPaymentReminder).toHaveBeenCalledWith("invoice", 2, expect.objectContaining({ provider: "resend" }), expect.objectContaining({ stage: 2 }));
    expect(mocks.insertReminderLog).toHaveBeenCalledWith({ invoiceId: "invoice", channel: "email", stage: 2, success: true, errorMessage: null });
    expect(mocks.getInvoice).toHaveBeenCalledTimes(1);
  });

  it.each(["paid", "draft", "cancelled"])("rejects %s invoices before dispatch", async (status) => {
    mocks.getInvoice.mockResolvedValue({ id: "invoice", status, balance: "125.00" });
    expect((await request(app).post("/api/invoices/invoice/remind")).status).toBe(409);
    expect(mocks.sendPaymentReminder).not.toHaveBeenCalled();
  });

  it("rejects zero-balance and paused invoices", async () => {
    mocks.getInvoice.mockResolvedValueOnce({ status: "sent", balance: "0" })
      .mockResolvedValueOnce({ status: "partial", balance: "12", remindersPaused: true });
    expect((await request(app).post("/api/invoices/invoice/remind")).status).toBe(409);
    expect((await request(app).post("/api/invoices/invoice/remind")).status).toBe(409);
    expect(mocks.sendPaymentReminder).not.toHaveBeenCalled();
  });

  it("reports a missing invoice and missing client email", async () => {
    mocks.getInvoice.mockResolvedValueOnce(undefined);
    expect((await request(app).post("/api/invoices/missing/remind")).status).toBe(404);
    mocks.getClient.mockResolvedValueOnce({});
    expect((await request(app).post("/api/invoices/invoice/remind")).status).toBe(400);
    expect(mocks.sendPaymentReminder).not.toHaveBeenCalled();
  });

  it("does not allow a dry run to masquerade as successful delivery", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect((await request(app).post("/api/invoices/invoice/remind")).status).toBe(503);
    expect(mocks.sendPaymentReminder).not.toHaveBeenCalled();
  });

  it("logs provider failure and never confirms delivery", async () => {
    mocks.sendPaymentReminder.mockResolvedValue({ success: false, error: "Provider rejected request" });
    const response = await request(app).post("/api/invoices/invoice/remind");
    expect(response.status).toBe(502);
    expect(response.body.success).toBeUndefined();
    expect(mocks.insertReminderLog).toHaveBeenCalledWith(expect.objectContaining({ success: false, errorMessage: "Provider rejected request" }));
  });
});
