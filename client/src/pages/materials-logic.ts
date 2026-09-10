import type { Job, JobMaterial } from "@shared/schema";

export type MaterialWithJob = JobMaterial & { job: Job | null };

export function filterMaterials(
  materials: MaterialWithJob[],
  jobFilter: string,
  search: string,
): MaterialWithJob[] {
  const normalized = search.trim().toLowerCase();
  return materials.filter((material) => {
    const matchesJob = jobFilter === "all" || material.jobId === jobFilter;
    const matchesSearch = !normalized
      || material.name.toLowerCase().includes(normalized)
      || material.description?.toLowerCase().includes(normalized)
      || material.vendor?.toLowerCase().includes(normalized)
      || material.job?.title.toLowerCase().includes(normalized);
    return matchesJob && matchesSearch;
  });
}

export function totalMaterialPrice(materials: Pick<JobMaterial, "price">[]): number {
  return materials.reduce((sum, material) => sum + Number(material.price), 0);
}

type MaterialQueryClient = {
  invalidateQueries(filters: { queryKey: string[] }): unknown;
};

export function invalidateMaterialTotals(client: MaterialQueryClient): void {
  client.invalidateQueries({ queryKey: ["/api/materials"] });
  client.invalidateQueries({ queryKey: ["/api/jobs"] });
}