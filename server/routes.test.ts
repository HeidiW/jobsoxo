import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "./test-helpers";

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
