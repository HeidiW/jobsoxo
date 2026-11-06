import type { Job, JobMaterial } from "@shared/schema";

export type MaterialWithJob = JobMaterial & { job: Job | null };

export function filterMaterials(
  materials: MaterialWithJob[],
  jobFilter: string,
  search: string,
): MaterialWithJob[] {
  const normalized = search.trim().toLowerCase();
  return materials.filter((material) => {
    const matchesJob = jobFilter === "all" || (jobFilter === "unassigned" ? !material.jobId : material.jobId === jobFilter);
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

export function monthlyMaterialSummary(
  materials: MaterialWithJob[],
  year: number,
  month: number,
): { total: number; jobs: { id: string; title: string; total: number; count: number }[]; unassigned: { total: number; count: number } } {
  const current = materials.filter((material) => {
    const date = material.purchaseDate.slice(0, 10);
    return Number(date.slice(0, 4)) === year && Number(date.slice(5, 7)) === month + 1;
  });
  const byJob = new Map<string, { id: string; title: string; total: number; count: number }>();
  const unassigned = { total: 0, count: 0 };
  for (const item of current) {
    if (!item.jobId || !item.job) {
      unassigned.total += Number(item.price);
      unassigned.count += 1;
    } else {
      const group = byJob.get(item.jobId) ?? { id: item.jobId, title: item.job.title, total: 0, count: 0 };
      group.total += Number(item.price);
      group.count += 1;
      byJob.set(item.jobId, group);
    }
  }
  return { total: totalMaterialPrice(current), jobs: [...byJob.values()].sort((a, b) => b.total - a.total), unassigned };
}

type MaterialQueryClient = {
  invalidateQueries(filters: { queryKey: string[] }): unknown;
};

export function invalidateMaterialTotals(client: MaterialQueryClient): void {
  client.invalidateQueries({ queryKey: ["/api/materials"] });
  client.invalidateQueries({ queryKey: ["/api/jobs"] });
}