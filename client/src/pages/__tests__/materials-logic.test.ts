import { describe, expect, it, vi } from "vitest";
import type { Job, JobMaterial } from "@shared/schema";
import {
  filterMaterials,
  invalidateMaterialTotals,
  monthlyMaterialSummary,
  totalMaterialPrice,
  type MaterialWithJob,
} from "../materials-logic";

const jobA = { id: "job-a", title: "Kitchen" } as Job;
const jobB = { id: "job-b", title: "Deck" } as Job;

function material(
  id: string,
  price: string,
  job: Job | null,
  overrides: Partial<JobMaterial> = {},
): MaterialWithJob {
  return {
    id,
    jobId: job?.id ?? null,
    name: `Material ${id}`,
    description: null,
    purchaseDate: "2026-09-03",
    vendor: null,
    quantity: "1.00",
    unit: "each",
    price,
    createdAt: new Date("2026-09-03T00:00:00Z"),
    ...overrides,
    job,
  };
}

describe("Materials total", () => {
  it("sums stored purchase totals rather than multiplying them by quantities", () => {
    expect(totalMaterialPrice([
      material("a", "10.25", jobA, { quantity: "4.00" }),
      material("b", "20.50", jobB, { quantity: "3.00" }),
    ])).toBe(30.75);
  });

  it("groups only the selected calendar month, including unassigned purchases", () => {
    const summary = monthlyMaterialSummary([
      material("a", "10.25", jobA, { purchaseDate: "2026-10-01", quantity: "4.00" }),
      material("b", "20.50", jobB, { purchaseDate: "2026-10-31" }),
      material("unassigned", "4.25", null, { purchaseDate: "2026-10-19" }),
      material("prior", "80.00", jobA, { purchaseDate: "2026-09-30" }),
      material("next", "90.00", jobB, { purchaseDate: "2026-11-01" }),
      material("last-year", "100.00", jobA, { purchaseDate: "2025-10-19" }),
    ], 2026, 9);
    expect(summary.total).toBe(35);
    expect(summary.jobs).toEqual([
      { id: jobB.id, title: jobB.title, total: 20.5, count: 1 },
      { id: jobA.id, title: jobA.title, total: 10.25, count: 1 },
    ]);
    expect(summary.unassigned).toEqual({ total: 4.25, count: 1 });
    expect(summary.jobs.reduce((sum, job) => sum + job.total, summary.unassigned.total)).toBe(summary.total);
  });

  it("handles January independently of the preceding December and supports unassigned filtering", () => {
    const materials = [
      material("dec", "20.00", jobA, { purchaseDate: "2025-12-31" }),
      material("jan", "3.25", null, { purchaseDate: "2026-01-01" }),
    ];
    expect(monthlyMaterialSummary(materials, 2026, 0)).toEqual({
      total: 3.25, jobs: [], unassigned: { total: 3.25, count: 1 },
    });
    expect(filterMaterials(materials, "unassigned", "").map((item) => item.id)).toEqual(["jan"]);
  });

  it("tracks all materials, including unassigned materials, and respects filters", () => {
    const materials = [
      material("a", "10.25", jobA, { vendor: "Paint Co" }),
      material("b", "20.50", jobB),
      material("unassigned", "4.25", null),
    ];

    expect(totalMaterialPrice(filterMaterials(materials, "all", ""))).toBe(35);
    expect(totalMaterialPrice(filterMaterials(materials, jobA.id, ""))).toBe(10.25);
    expect(totalMaterialPrice(filterMaterials(materials, "all", "paint"))).toBe(10.25);
    expect(totalMaterialPrice(filterMaterials(materials, "all", "unassigned"))).toBe(4.25);
  });

  it("recalculates after add, edit, delete, and moving a material between jobs", () => {
    const first = material("a", "10.00", jobA);
    let materials = [first];
    expect(totalMaterialPrice(filterMaterials(materials, jobA.id, ""))).toBe(10);

    materials = [...materials, material("b", "5.50", jobA)];
    expect(totalMaterialPrice(filterMaterials(materials, jobA.id, ""))).toBe(15.5);

    materials = materials.map((item) => item.id === "a" ? { ...item, price: "12.00" } : item);
    expect(totalMaterialPrice(filterMaterials(materials, jobA.id, ""))).toBe(17.5);

    materials = materials.map((item) => item.id === "b" ? { ...item, jobId: jobB.id, job: jobB } : item);
    expect(totalMaterialPrice(filterMaterials(materials, jobA.id, ""))).toBe(12);
    expect(totalMaterialPrice(filterMaterials(materials, jobB.id, ""))).toBe(5.5);

    materials = materials.filter((item) => item.id !== "a");
    expect(totalMaterialPrice(filterMaterials(materials, jobA.id, ""))).toBe(0);
  });

  it("refreshes both the materials list and job-detail total after mutations", () => {
    const invalidateQueries = vi.fn();
    invalidateMaterialTotals({ invalidateQueries });

    expect(invalidateQueries).toHaveBeenNthCalledWith(1, { queryKey: ["/api/materials"] });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, { queryKey: ["/api/jobs"] });
  });
});