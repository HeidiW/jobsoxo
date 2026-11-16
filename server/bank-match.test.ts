import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { buildTestApp } from "./test-helpers";
import { storage } from "./storage";
import { db } from "./db";
import { bankAccounts, payments, plaidTransactions, users } from "@shared/schema";
import { describeUnmatched, unmatchedManualPayments } from "./bank-match";

const NOW = new Date("2026-11-16T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("unmatched hand-recorded payments", () => {
  let app: Express;
  let userId: string;
  let invoiceId: string;
  beforeAll(async () => {
    app = await buildTestApp();
    const [user] = await db.select({ id: users.id }).from(users).limit(1);
    userId = user?.id ?? (await storage.createUser({ username: `bank_${Date.now()}`, password: "x", name: "Bank Tester" } as never)).id;
    const client = await storage.createClient({ name: "Ramp Contractors", email: "ap@example.test" } as never);
    const invoice = await storage.createInvoice({ clientId: client.id, invoiceNumber: `BANK-${Date.now()}`, status: "sent", issueDate: NOW, dueDate: NOW, subtotal: "9000.00", taxRate: "0", taxAmount: "0", total: "9000.00", amountPaid: "0", balance: "9000.00" } as never);
    invoiceId = invoice.id;
  });

  const record = (overrides: Partial<typeof payments.$inferInsert>) => db.insert(payments).values({
    invoiceId, amount: "2500.00", paymentMethod: "check", referenceNumber: "1042", paymentDate: daysAgo(15), status: "succeeded", ...overrides,
  }).returning().then((rows) => rows[0]);

  it("is silent until a business bank account is connected", async () => {
    await record({});
    expect(await unmatchedManualPayments(NOW)).toEqual([]);
  });

  it("raises an old check with no matched deposit, and nothing else", async () => {
    await db.insert(bankAccounts).values({ userId, entityType: "business", plaidItemId: "item_t", plaidAccessToken: "enc", plaidAccountId: "acc_t", institutionName: "First Platypus", accountName: "Checking", accountMask: "0000" });
    const stale = await record({ referenceNumber: "1042" });
    const matched = await record({ referenceNumber: "1043", amount: "1000.00" });
    await db.insert(plaidTransactions).values({ userId, plaidTransactionId: `tx_${Date.now()}`, plaidAccountId: "acc_t", date: daysAgo(14), amount: "1000.00", name: "CHECK DEPOSIT", matchedPaymentId: matched.id });
    await record({ referenceNumber: "1044", paymentDate: daysAgo(3) });                       // too recent to worry about
    await record({ referenceNumber: null, paymentMethod: "credit_card", providerRef: `pi_${Date.now()}` }); // Stripe vouches for this one
    await record({ referenceNumber: "1045", status: "processing" });                           // not counted yet anyway

    const rows = await unmatchedManualPayments(NOW);
    expect(rows.map((row) => row.paymentId)).toEqual([stale.id]);
    expect(rows[0]).toMatchObject({ invoiceId, clientName: "Ramp Contractors", amount: 2500, paymentMethod: "check", referenceNumber: "1042", daysUnmatched: 15 });
    expect(describeUnmatched(rows[0])).toBe("Check #1042 for $2,500.00 recorded Nov 1; no matching bank deposit after 15 days. Match it under Settings → Bank Account.");

    // The dashboard shows it, after any Stripe mismatch and before reminders.
    const dashboard = (await request(app).get("/api/dashboard?today=2026-11-16").expect(200)).body;
    const item = dashboard.needsAttention.find((row: { invoiceId: string }) => row.invoiceId === invoiceId);
    expect(item).toMatchObject({ reason: "unmatched-deposit", client: "Ramp Contractors", detail: describeUnmatched(rows[0]) });

    // Matching the deposit clears it with no further action.
    await db.insert(plaidTransactions).values({ userId, plaidTransactionId: `tx2_${Date.now()}`, plaidAccountId: "acc_t", date: daysAgo(13), amount: "2500.00", name: "CHECK DEPOSIT", matchedPaymentId: stale.id });
    expect(await unmatchedManualPayments(NOW)).toEqual([]);
    expect((await request(app).get("/api/dashboard?today=2026-11-16").expect(200)).body.needsAttention.some((row: { reason: string }) => row.reason === "unmatched-deposit")).toBe(false);
    expect((await db.select().from(payments).where(eq(payments.invoiceId, invoiceId))).length).toBeGreaterThan(0);
  });
});
