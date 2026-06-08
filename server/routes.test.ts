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
