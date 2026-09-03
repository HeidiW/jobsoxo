import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp, buildAdminTestApp } from "./test-helpers";
import { storage } from "./storage";

let app: Express;

beforeAll(async () => {
  app = await buildTestApp();
});

describe("POST /api/clients — validation", () => {
  it("returns 400 when name is missing", async () => {
    const res = await request(app)
      .post("/api/clients")
      .send({ email: "nope@example.com" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("name");
  });
});

describe("PATCH /api/clients/:id — validation", () => {
  it("returns 400 when email is not a string", async () => {
    const res = await request(app)
      .patch("/api/clients/nonexistent-id")
      .send({ email: 12345 })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("email");
  });
});

describe("POST /api/jobs — validation", () => {
  it("returns 400 when clientId and title are missing", async () => {
    const res = await request(app)
      .post("/api/jobs")
      .send({ description: "some job" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("clientId");
    expect(res.body.details).toHaveProperty("title");
  });

  it("returns 400 when title is missing", async () => {
    const res = await request(app)
      .post("/api/jobs")
      .send({ clientId: "some-client-id" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("title");
  });
});

describe("PATCH /api/jobs/:id — validation", () => {
  it("returns 400 when startDate is an invalid date string", async () => {
    const res = await request(app)
      .patch("/api/jobs/nonexistent-id")
      .send({ startDate: "not-a-date" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("startDate");
  });

  it("returns 400 when endDate is an invalid date string", async () => {
    const res = await request(app)
      .patch("/api/jobs/nonexistent-id")
      .send({ endDate: "not-a-date" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("endDate");
  });
});

describe("POST /api/invoices — validation", () => {
  it("returns 400 when clientId is missing", async () => {
    const res = await request(app)
      .post("/api/invoices")
      .send({ dueDate: "2025-12-31" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("clientId");
  });

  it("returns 400 when dueDate is missing", async () => {
    const res = await request(app)
      .post("/api/invoices")
      .send({ clientId: "some-client-id" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("dueDate");
  });

  it("returns 400 when both clientId and dueDate are missing", async () => {
    const res = await request(app)
      .post("/api/invoices")
      .send({})
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("clientId");
    expect(res.body.details).toHaveProperty("dueDate");
  });

  it("returns 400 when dueDate is not a valid date", async () => {
    const res = await request(app)
      .post("/api/invoices")
      .send({ clientId: "some-client-id", dueDate: "not-a-date" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("dueDate");
  });
});

describe("PATCH /api/invoices/:id — validation", () => {
  it("returns 400 when dueDate is not a valid date string", async () => {
    const res = await request(app)
      .patch("/api/invoices/nonexistent-id")
      .send({ dueDate: "not-a-real-date" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("dueDate");
  });

  it("returns 400 when issueDate is not a valid date string", async () => {
    const res = await request(app)
      .patch("/api/invoices/nonexistent-id")
      .send({ issueDate: "definitely-not-a-date" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("issueDate");
  });
});

describe("POST /api/employees — validation", () => {
  it("returns 400 when name is missing", async () => {
    const res = await request(app)
      .post("/api/employees")
      .send({ dayRate: "25.00" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("name");
  });

  it("returns 400 when dayRate is missing", async () => {
    const res = await request(app)
      .post("/api/employees")
      .send({ name: "Jane Doe" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("dayRate");
  });

  it("returns 400 when both name and dayRate are missing", async () => {
    const res = await request(app)
      .post("/api/employees")
      .send({})
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("name");
    expect(res.body.details).toHaveProperty("dayRate");
  });
});

describe("PATCH /api/employees/:id — validation", () => {
  it("returns 400 when hireDate is an invalid date string", async () => {
    const res = await request(app)
      .patch("/api/employees/nonexistent-id")
      .send({ hireDate: "not-a-date" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("hireDate");
  });
});

describe("POST /api/invoices/:id/payments — validation", () => {
  it("returns 400 when amount is missing", async () => {
    const res = await request(app)
      .post("/api/invoices/nonexistent-id/payments")
      .send({ paymentMethod: "cash", paymentDate: "2025-01-15" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("amount");
  });

  it("returns 400 when paymentMethod is an invalid enum value", async () => {
    const res = await request(app)
      .post("/api/invoices/nonexistent-id/payments")
      .send({ amount: "500", paymentMethod: "bitcoin", paymentDate: "2025-01-15" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("paymentMethod");
  });

  it("returns 400 when paymentDate is not a valid date", async () => {
    const res = await request(app)
      .post("/api/invoices/nonexistent-id/payments")
      .send({ amount: "500", paymentMethod: "cash", paymentDate: "not-a-date" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("paymentDate");
  });
});

describe("POST /api/line-items — blank numeric fields", () => {
  it("returns 400 when quantity is blank", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "", unit: "hours", rate: "50", amount: "100" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("quantity");
  });

  it("returns 400 when quantity is missing", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", unit: "hours", rate: "50", amount: "100" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("quantity");
  });

  it("returns 400 when rate is blank", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "2", unit: "hours", rate: "", amount: "100" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("rate");
  });

  it("returns 400 when rate is missing", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "2", unit: "hours", amount: "100" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("rate");
  });

  it("returns 400 when amount is blank", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "2", unit: "hours", rate: "50", amount: "" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("amount");
  });

  it("returns 400 when amount is missing", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "2", unit: "hours", rate: "50" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("amount");
  });
});

describe("PATCH /api/invoices/:id — blank numeric fields", () => {
  it("returns 400 when subtotal is blank", async () => {
    const res = await request(app)
      .patch("/api/invoices/nonexistent-id")
      .send({ subtotal: "" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("subtotal");
  });

  it("returns 400 when total is blank", async () => {
    const res = await request(app)
      .patch("/api/invoices/nonexistent-id")
      .send({ total: "" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("total");
  });

  it("returns 400 when balance is blank", async () => {
    const res = await request(app)
      .patch("/api/invoices/nonexistent-id")
      .send({ balance: "" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("balance");
  });
});

describe("PATCH /api/payroll-records/:id — blank numeric fields", () => {
  it("returns 400 when totalHours is blank", async () => {
    const res = await request(app)
      .patch("/api/payroll-records/nonexistent-id")
      .send({ totalHours: "" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("totalHours");
  });

  it("returns 400 when dayRate is blank", async () => {
    const res = await request(app)
      .patch("/api/payroll-records/nonexistent-id")
      .send({ dayRate: "" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("dayRate");
  });

  it("returns 400 when grossPay is blank", async () => {
    const res = await request(app)
      .patch("/api/payroll-records/nonexistent-id")
      .send({ grossPay: "" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("grossPay");
  });

  it("returns 400 when netPay is blank", async () => {
    const res = await request(app)
      .patch("/api/payroll-records/nonexistent-id")
      .send({ netPay: "" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("netPay");
  });
});

describe("POST /api/line-items — non-numeric strings", () => {
  it("returns 400 when quantity is a non-numeric string", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "abc", unit: "hours", rate: "50", amount: "100" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("quantity");
  });

  it("returns 400 when rate is a non-numeric string", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "2", unit: "hours", rate: "abc", amount: "100" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("rate");
  });

  it("returns 400 when amount is a non-numeric string", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "2", unit: "hours", rate: "50", amount: "abc" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("amount");
  });
});

describe("POST /api/line-items — negative numeric values", () => {
  it("returns 400 when quantity is negative", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "-1", unit: "hours", rate: "50", amount: "100" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("quantity");
  });

  it("returns 400 when rate is negative", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "2", unit: "hours", rate: "-10", amount: "100" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("rate");
  });

  it("returns 400 when amount is negative", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "2", unit: "hours", rate: "50", amount: "-100" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("amount");
  });
});

describe("POST /api/line-items — amount vs quantity×rate mismatch", () => {
  it("returns 400 when amount does not equal quantity × rate", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "2", unit: "hours", rate: "50", amount: "999" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("amount");
  });

  it("returns 400 when amount is slightly off from quantity × rate", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "3", unit: "hours", rate: "25", amount: "74.99" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("amount");
  });

  it("passes when amount exactly equals quantity × rate", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "2", unit: "hours", rate: "50", amount: "100" });

    expect(res.status).not.toBe(400);
  });

  it("passes when amount equals quantity × rate with floating-point values", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "materials", description: "Paint", quantity: "1.5", unit: "gallon", rate: "20", amount: "30" });

    expect(res.status).not.toBe(400);
  });
});

describe("POST /api/line-items — zero numeric values", () => {
  it("returns 400 when quantity is zero", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "0", unit: "hours", rate: "50", amount: "100" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("quantity");
  });

  it("returns 400 when rate is zero", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "2", unit: "hours", rate: "0", amount: "100" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("rate");
  });

  it("returns 400 when amount is zero", async () => {
    const res = await request(app)
      .post("/api/line-items")
      .send({ category: "labor", description: "Painting", quantity: "2", unit: "hours", rate: "50", amount: "0" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("amount");
  });
});

describe("POST /api/invoices/:id/payments — negative and non-numeric amount", () => {
  it("returns 400 when amount is negative", async () => {
    const res = await request(app)
      .post("/api/invoices/nonexistent-id/payments")
      .send({ amount: "-500", paymentMethod: "cash", paymentDate: "2025-01-15" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("amount");
  });

  it("returns 400 when amount is a non-numeric string", async () => {
    const res = await request(app)
      .post("/api/invoices/nonexistent-id/payments")
      .send({ amount: "abc", paymentMethod: "cash", paymentDate: "2025-01-15" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("amount");
  });
});

describe("POST /api/employees — non-numeric and negative dayRate", () => {
  it("returns 400 when dayRate is a non-numeric string", async () => {
    const res = await request(app)
      .post("/api/employees")
      .send({ name: "Jane Doe", dayRate: "abc" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("dayRate");
  });

  it("returns 400 when dayRate is negative", async () => {
    const res = await request(app)
      .post("/api/employees")
      .send({ name: "Jane Doe", dayRate: "-25" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("dayRate");
  });
});

describe("PATCH /api/payroll-records/:id — non-numeric and negative numeric fields", () => {
  it("returns 400 when totalHours is a non-numeric string", async () => {
    const res = await request(app)
      .patch("/api/payroll-records/nonexistent-id")
      .send({ totalHours: "abc" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("totalHours");
  });

  it("returns 400 when dayRate is a non-numeric string", async () => {
    const res = await request(app)
      .patch("/api/payroll-records/nonexistent-id")
      .send({ dayRate: "abc" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("dayRate");
  });

  it("returns 400 when grossPay is negative", async () => {
    const res = await request(app)
      .patch("/api/payroll-records/nonexistent-id")
      .send({ grossPay: "-100" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("grossPay");
  });

  it("returns 400 when netPay is negative", async () => {
    const res = await request(app)
      .patch("/api/payroll-records/nonexistent-id")
      .send({ netPay: "-50" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("netPay");
  });

  it("returns 400 when dayRate is negative", async () => {
    const res = await request(app)
      .patch("/api/payroll-records/nonexistent-id")
      .send({ dayRate: "-15" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("dayRate");
  });
});

describe("PATCH /api/payroll-records/:id — zero numeric values", () => {
  it("returns 400 when totalHours is zero", async () => {
    const res = await request(app)
      .patch("/api/payroll-records/nonexistent-id")
      .send({ totalHours: "0" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("totalHours");
  });

  it("returns 400 when grossPay is zero", async () => {
    const res = await request(app)
      .patch("/api/payroll-records/nonexistent-id")
      .send({ grossPay: "0" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("grossPay");
  });
});

describe("POST /api/payroll-records/run — zero-hour employee filtering", () => {
  it("returns 201 with an empty array when no employees have time entries in the period", async () => {
    const res = await request(app)
      .post("/api/payroll-records/run")
      .send({ periodStart: "2000-01-01", periodEnd: "2000-01-31" })
      .expect(201);

    expect(Array.isArray(res.body)).toBe(true);
    for (const record of res.body) {
      expect(parseFloat(record.totalHours)).toBeGreaterThan(0);
      expect(parseFloat(record.grossPay)).toBeGreaterThan(0);
    }
  });
});

describe("POST /api/payroll-records/run — per-employee deductions (global deductionRate removed)", () => {
  it("accepts a run without deductionRate (deductions are now per-employee)", async () => {
    const res = await request(app)
      .post("/api/payroll-records/run")
      .send({ periodStart: "2001-01-01", periodEnd: "2001-01-31" })
      .expect(201);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it("ignores a passed deductionRate field and still returns 201", async () => {
    const res = await request(app)
      .post("/api/payroll-records/run")
      .send({ periodStart: "2002-01-01", periodEnd: "2002-01-31", deductionRate: 50 })
      .expect(201);

    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("POST /api/payroll-records/run — future date validation", () => {
  it("returns 400 when periodStart is in the future", async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const futureDateStr = futureDate.toISOString().slice(0, 10);
    const endDateStr = new Date(futureDate.getTime() + 14 * 86400000).toISOString().slice(0, 10);

    const res = await request(app)
      .post("/api/payroll-records/run")
      .send({ periodStart: futureDateStr, periodEnd: endDateStr })
      .expect(400);

    expect(res.body.error).toBe("periodStart cannot be in the future");
  });

  it("does not reject periodStart = today as a future date", async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    const endDate = new Date(today.getTime() + 14 * 86400000);
    const endDateStr = endDate.toISOString().slice(0, 10);

    const res = await request(app)
      .post("/api/payroll-records/run")
      .send({ periodStart: todayStr, periodEnd: endDateStr });

    // Today must not be rejected as "in the future" — that is what this test guards.
    // A 400 due to an overlapping period (from a prior test run) is acceptable.
    if (res.status === 400) {
      expect(res.body.error).not.toBe("periodStart cannot be in the future");
    } else {
      expect(res.status).toBe(201);
      expect(Array.isArray(res.body)).toBe(true);
    }
  });
});

describe("POST /api/payroll-records/run — overlapping period validation", () => {
  it("returns 400 when the period overlaps an already-processed payroll period", async () => {
    const empRes = await request(app)
      .post("/api/employees")
      .send({ name: "Overlap Test Employee", dayRate: "20", status: "active" })
      .expect(201);

    const employeeId = empRes.body.id;

    await storage.createPayrollRecord({
      employeeId,
      periodStart: new Date("2001-05-01"),
      periodEnd: new Date("2001-05-31"),
      totalHours: "80",
      dayRate: "20",
      grossPay: "1600",
      deductions: "0",
      netPay: "1600",
      status: "pending",
    });

    const overlapRes = await request(app)
      .post("/api/payroll-records/run")
      .send({ periodStart: "2001-05-15", periodEnd: "2001-06-15" })
      .expect(400);

    expect(overlapRes.body.error).toBe("This period overlaps with an already-processed payroll period");
  });
});

describe("POST /api/time-entries — validation", () => {
  it("returns 400 when employeeId is missing", async () => {
    const res = await request(app)
      .post("/api/time-entries")
      .send({ date: "2025-01-15", hoursWorked: "8" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("employeeId");
  });

  it("returns 400 when hoursWorked is missing", async () => {
    const res = await request(app)
      .post("/api/time-entries")
      .send({ employeeId: "some-employee-id", date: "2025-01-15" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("hoursWorked");
  });

  it("returns 400 when date is missing", async () => {
    const res = await request(app)
      .post("/api/time-entries")
      .send({ employeeId: "some-employee-id", hoursWorked: "8" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("date");
  });

  it("returns 400 when date is not a valid date string", async () => {
    const res = await request(app)
      .post("/api/time-entries")
      .send({ employeeId: "some-employee-id", hoursWorked: "8", date: "not-a-date" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("date");
  });

  it("returns 400 when adding an entry would push the daily total past 24 hours", async () => {
    const empRes = await request(app)
      .post("/api/employees")
      .send({ name: "Daily Limit Test Employee", dayRate: "15", status: "active" })
      .expect(201);
    const employeeId = empRes.body.id;

    await storage.createTimeEntry({ employeeId, date: new Date("2030-03-10T12:00:00Z"), hoursWorked: "20", description: "first shift" });

    const res = await request(app)
      .post("/api/time-entries")
      .send({ employeeId, date: "2030-03-10", hoursWorked: "8" })
      .expect(400);

    expect(res.body.error).toMatch(/daily total/i);
    expect(res.body.error).toMatch(/24/);
  });
});

describe("PATCH /api/settings — access control", () => {
  it("returns 403 for non-admin users", async () => {
    const res = await request(app)
      .patch("/api/settings")
      .send({ inboxSyncHour: 9 })
      .expect(403);

    expect(res.body.error).toBe("Admin access required");
  });
});

describe("PATCH /api/settings — inboxSyncHour validation", () => {
  let adminApp: Express;

  beforeAll(async () => {
    adminApp = await buildAdminTestApp();
  });

  it("returns 400 when inboxSyncHour is above 23", async () => {
    const res = await request(adminApp)
      .patch("/api/settings")
      .send({ inboxSyncHour: 24 })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("inboxSyncHour");
  });

  it("returns 400 when inboxSyncHour is below 0", async () => {
    const res = await request(adminApp)
      .patch("/api/settings")
      .send({ inboxSyncHour: -1 })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("inboxSyncHour");
  });

  it("allows admin to set a valid inboxSyncHour", async () => {
    const res = await request(adminApp)
      .patch("/api/settings")
      .send({ inboxSyncHour: 9 })
      .expect(200);

    expect(res.body.inboxSyncHour).toBe(9);
  });
});
describe("POST /api/employees/:id/send-deposit-link — pending token guard", () => {
  it("returns 409 with hasPendingToken when a valid token already exists", async () => {
    // Create an employee with an email address
    const empRes = await request(app)
      .post("/api/employees")
      .send({ name: "Token Guard Test", dayRate: "200", status: "active", email: "tokentest@example.com" })
      .expect(201);
    const employeeId = empRes.body.id;

    // Seed a non-expired token directly via storage
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await storage.setEmployeeDirectDepositToken(employeeId, "existing-token-abc", expiry, "test-user");

    // First send (no force) should return 409
    const res = await request(app)
      .post(`/api/employees/${employeeId}/send-deposit-link`)
      .send({})
      .expect(409);

    expect(res.body.hasPendingToken).toBe(true);
    expect(res.body.email).toBe("tokentest@example.com");
  });

  it("overwrites the old token and does not return 409 when force=true", async () => {
    const empRes = await request(app)
      .post("/api/employees")
      .send({ name: "Force Send Test", dayRate: "200", status: "active", email: "forcesend@example.com" })
      .expect(201);
    const employeeId = empRes.body.id;

    // Seed a non-expired token
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await storage.setEmployeeDirectDepositToken(employeeId, "old-token-xyz", expiry, "test-user");

    // force=true must not return 409; the server replaces the token before attempting email
    const res = await request(app)
      .post(`/api/employees/${employeeId}/send-deposit-link`)
      .send({ force: true });

    expect(res.status).not.toBe(409);

    // Verify the token in the DB was actually replaced (not the old value)
    const updated = await storage.getEmployee(employeeId);
    expect((updated as any).directDepositToken).not.toBe("old-token-xyz");
    expect((updated as any).directDepositToken).toBeTruthy();
  });
});

describe("GET /api/plaid/searchable-payments — access control", () => {
  it("returns 403 for non-admin users", async () => {
    const res = await request(app)
      .get("/api/plaid/searchable-payments")
      .expect(403);

    expect(res.body.error).toBe("Admin access required");
  });

  it("returns 200 for admin users", async () => {
    const adminApp = await buildAdminTestApp();
    const res = await request(adminApp)
      .get("/api/plaid/searchable-payments")
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("PATCH /api/plaid/transactions/:txId/match — access control", () => {
  it("returns 403 for non-admin users", async () => {
    const res = await request(app)
      .patch("/api/plaid/transactions/some-tx-id/match")
      .send({ paymentId: "some-payment-id" })
      .expect(403);

    expect(res.body.error).toBe("Admin access required");
  });

  it("returns 400 when paymentId is missing", async () => {
    const adminApp = await buildAdminTestApp();
    const res = await request(adminApp)
      .patch("/api/plaid/transactions/some-tx-id/match")
      .send({})
      .expect(400);

    expect(res.body.error).toMatch(/paymentId/i);
  });

  it("returns 404 when payment does not exist", async () => {
    const adminApp = await buildAdminTestApp();
    const res = await request(adminApp)
      .patch("/api/plaid/transactions/some-tx-id/match")
      .send({ paymentId: "00000000-0000-0000-0000-000000000000" })
      .expect(404);

    expect(res.body.error).toMatch(/payment not found/i);
  });
});

describe("DELETE /api/plaid/transactions/:txId/match — access control", () => {
  it("returns 403 for non-admin users", async () => {
    const res = await request(app)
      .delete("/api/plaid/transactions/some-tx-id/match")
      .expect(403);

    expect(res.body.error).toBe("Admin access required");
  });

  it("returns 404 when transaction does not exist", async () => {
    const adminApp = await buildAdminTestApp();
    const res = await request(adminApp)
      .delete("/api/plaid/transactions/00000000-0000-0000-0000-000000000000/match")
      .expect(404);

    expect(res.body.error).toMatch(/transaction not found/i);
  });
});
// ── Inbox restore flow ────────────────────────────────────────────────────────
// Uses buildAdminTestApp so all requests are authenticated as a real DB user,
// satisfying the inbox_tasks.user_id → users.id foreign key constraint.
describe("PATCH /api/inbox/tasks/:emailId/restore — restore dismissed email", () => {
  let adminApp: Express;
  let adminUserId: string;
  const emailId = `restore-test-${Date.now()}`;

  beforeAll(async () => {
    adminApp = await buildAdminTestApp();
    // __test_admin__ is created (or reused) by buildAdminTestApp
    const adminUser = await storage.getUserByUsername("__test_admin__");
    adminUserId = adminUser!.id;

    // Seed: create a task that is already dismissed
    await storage.upsertInboxTask({
      userId: adminUserId,
      emailId,
      subject: "Restore Integration Test",
      sender: "Test Sender",
      senderEmail: "sender@example.com",
      snippet: "Integration test snippet",
      receivedAt: new Date(),
      isRead: true,
      isDone: false,
    });
    await storage.dismissInboxTask(adminUserId, emailId);
  });

  it("removes the email from the hidden (dismissed) list after restore", async () => {
    const hiddenBefore = await request(adminApp)
      .get("/api/inbox/tasks/hidden")
      .expect(200);

    const dismissedBefore = (hiddenBefore.body as Array<{ emailId: string; dismissed: boolean }>)
      .filter((t) => t.dismissed);
    const countBefore = dismissedBefore.length;
    expect(dismissedBefore.some((t) => t.emailId === emailId)).toBe(true);

    await request(adminApp)
      .patch(`/api/inbox/tasks/${emailId}/restore`)
      .expect(200);

    const hiddenAfter = await request(adminApp)
      .get("/api/inbox/tasks/hidden")
      .expect(200);

    const dismissedAfter = (hiddenAfter.body as Array<{ emailId: string; dismissed: boolean }>)
      .filter((t) => t.dismissed);

    expect(dismissedAfter.some((t) => t.emailId === emailId)).toBe(false);
    expect(dismissedAfter.length).toBe(countBefore - 1);
  });

  it("makes the restored email appear in the active task list", async () => {
    const activeTasks = await request(adminApp)
      .get("/api/inbox/tasks")
      .expect(200);

    const found = (activeTasks.body as Array<{ emailId: string; dismissed: boolean }>)
      .find((t) => t.emailId === emailId);

    expect(found).toBeDefined();
    expect(found!.dismissed).toBe(false);
  });

  it("returns 404 when restoring a non-existent email", async () => {
    await request(adminApp)
      .patch("/api/inbox/tasks/nonexistent-email-id-xyz/restore")
      .expect(404);
  });
});

describe("PATCH /api/inbox/tasks/:emailId/restore — select-all count accuracy", () => {
  let adminApp: Express;
  let adminUserId: string;
  const emailA = `restore-count-a-${Date.now()}`;
  const emailB = `restore-count-b-${Date.now()}`;

  beforeAll(async () => {
    adminApp = await buildAdminTestApp();
    const adminUser = await storage.getUserByUsername("__test_admin__");
    adminUserId = adminUser!.id;

    // Seed two dismissed tasks to verify count drops by exactly 1
    for (const id of [emailA, emailB]) {
      await storage.upsertInboxTask({
        userId: adminUserId,
        emailId: id,
        subject: `Count Test ${id}`,
        sender: "Count Sender",
        senderEmail: "count@example.com",
        snippet: "Count test snippet",
        receivedAt: new Date(),
        isRead: true,
        isDone: false,
      });
      await storage.dismissInboxTask(adminUserId, id);
    }
  });

  it("dismissed count drops by exactly 1 when one email is restored", async () => {
    const before = await request(adminApp).get("/api/inbox/tasks/hidden").expect(200);
    const dismissedBefore = (before.body as Array<{ emailId: string; dismissed: boolean }>)
      .filter((t) => t.dismissed).length;

    await request(adminApp)
      .patch(`/api/inbox/tasks/${emailA}/restore`)
      .expect(200);

    const after = await request(adminApp).get("/api/inbox/tasks/hidden").expect(200);
    const dismissedAfter = (after.body as Array<{ emailId: string; dismissed: boolean }>)
      .filter((t) => t.dismissed).length;

    expect(dismissedAfter).toBe(dismissedBefore - 1);
    // emailB should still be in the dismissed list (select-all count remains accurate)
    expect(
      (after.body as Array<{ emailId: string }>).some((t) => t.emailId === emailB)
    ).toBe(true);
  });
});
