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
      .send({ hourlyRate: "25.00" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("name");
  });

  it("returns 400 when hourlyRate is missing", async () => {
    const res = await request(app)
      .post("/api/employees")
      .send({ name: "Jane Doe" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("hourlyRate");
  });

  it("returns 400 when both name and hourlyRate are missing", async () => {
    const res = await request(app)
      .post("/api/employees")
      .send({})
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("name");
    expect(res.body.details).toHaveProperty("hourlyRate");
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

  it("returns 400 when hourlyRate is blank", async () => {
    const res = await request(app)
      .patch("/api/payroll-records/nonexistent-id")
      .send({ hourlyRate: "" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("hourlyRate");
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

describe("POST /api/employees — non-numeric and negative hourlyRate", () => {
  it("returns 400 when hourlyRate is a non-numeric string", async () => {
    const res = await request(app)
      .post("/api/employees")
      .send({ name: "Jane Doe", hourlyRate: "abc" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("hourlyRate");
  });

  it("returns 400 when hourlyRate is negative", async () => {
    const res = await request(app)
      .post("/api/employees")
      .send({ name: "Jane Doe", hourlyRate: "-25" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("hourlyRate");
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

  it("returns 400 when hourlyRate is a non-numeric string", async () => {
    const res = await request(app)
      .patch("/api/payroll-records/nonexistent-id")
      .send({ hourlyRate: "abc" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("hourlyRate");
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

  it("returns 400 when hourlyRate is negative", async () => {
    const res = await request(app)
      .patch("/api/payroll-records/nonexistent-id")
      .send({ hourlyRate: "-15" })
      .expect(400);

    expect(res.body.error).toBe("Invalid request data");
    expect(res.body.details).toHaveProperty("hourlyRate");
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

describe("POST /api/payroll-records/run — deductionRate validation", () => {
  it("returns 400 when deductionRate is a non-numeric string", async () => {
    const res = await request(app)
      .post("/api/payroll-records/run")
      .send({ periodStart: "2025-01-01", periodEnd: "2025-01-31", deductionRate: "abc" })
      .expect(400);

    expect(res.body.error).toBe("deductionRate must be a number between 0 and 100");
  });

  it("returns 400 when deductionRate is negative", async () => {
    const res = await request(app)
      .post("/api/payroll-records/run")
      .send({ periodStart: "2025-01-01", periodEnd: "2025-01-31", deductionRate: -5 })
      .expect(400);

    expect(res.body.error).toBe("deductionRate must be a number between 0 and 100");
  });

  it("returns 400 when deductionRate exceeds 100", async () => {
    const res = await request(app)
      .post("/api/payroll-records/run")
      .send({ periodStart: "2025-01-01", periodEnd: "2025-01-31", deductionRate: 200 })
      .expect(400);

    expect(res.body.error).toBe("deductionRate must be a number between 0 and 100");
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

  it("returns 201 when periodStart is today", async () => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);
    const endDate = new Date(today.getTime() + 14 * 86400000);
    const endDateStr = endDate.toISOString().slice(0, 10);

    const res = await request(app)
      .post("/api/payroll-records/run")
      .send({ periodStart: todayStr, periodEnd: endDateStr })
      .expect(201);

    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("POST /api/payroll-records/run — overlapping period validation", () => {
  it("returns 400 when the period overlaps an already-processed payroll period", async () => {
    const empRes = await request(app)
      .post("/api/employees")
      .send({ name: "Overlap Test Employee", hourlyRate: "20", status: "active" })
      .expect(201);

    const employeeId = empRes.body.id;

    await storage.createPayrollRecord({
      employeeId,
      periodStart: new Date("2001-05-01"),
      periodEnd: new Date("2001-05-31"),
      totalHours: "80",
      hourlyRate: "20",
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
