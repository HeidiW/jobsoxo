import { describe, expect, it, vi } from "vitest";
import type { Job, JobMaterial } from "@shared/schema";
import {
  filterMaterials,
  invalidateMaterialTotals,
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