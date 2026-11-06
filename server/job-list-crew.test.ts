import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { buildTestApp } from "./test-helpers";
import { storage } from "./storage";

let app: Express;
beforeAll(async () => { app = await buildTestApp(); });

describe("job-list scheduling crew", () => {
  it("returns only the assigned crew per job without exposing payroll details", async () => {
    const suffix = randomUUID();
    const client = await storage.createClient({ name: `Crew list check ${suffix}` });
    const employee = await storage.createEmployee({ name: `Assigned worker ${suffix}`, dayRate: "200.00" });
    try {
      const assigned = await storage.createJob({ clientId: client.id, title: "Assigned site" });
      const unassigned = await storage.createJob({ clientId: client.id, title: "Unassigned site" });
      await request(app).put(`/api/jobs/${assigned.id}/assignments`).send({ employeeIds: [employee.id] }).expect(200);
      const response = await request(app).get("/api/jobs").expect(200);
      expect(response.body.find((job: { id: string }) => job.id === assigned.id).assignedEmployees)
        .toEqual([{ id: employee.id, name: employee.name }]);
      expect(response.body.find((job: { id: string }) => job.id === unassigned.id).assignedEmployees).toEqual([]);
      await request(app).put(`/api/jobs/${assigned.id}/assignments`).send({ employeeIds: [] }).expect(200);
      const refreshed = await request(app).get("/api/jobs").expect(200);
      expect(refreshed.body.find((job: { id: string }) => job.id === assigned.id).assignedEmployees).toEqual([]);
    } finally {
      await storage.deleteClient(client.id);
      await storage.deleteEmployee(employee.id);
    }
  });
});
