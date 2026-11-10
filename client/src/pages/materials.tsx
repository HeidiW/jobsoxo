import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertTriangle, Edit, Package, Plus, ScanLine, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MaterialFormDialog } from "@/components/materials/material-form-dialog";
import { ReceiptScanDialog } from "@/components/materials/receipt-scan-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";
import type { Job } from "@shared/schema";
import { filterMaterials, invalidateMaterialTotals, monthlyMaterialSummary, totalMaterialPrice, type MaterialWithJob } from "./materials-logic";

const CARD_TINTS = [
  { card: "bg-jx-green-tint", ink: "text-jx-green-ink" },
  { card: "bg-jx-orange-tint", ink: "text-jx-orange-ink" },
  { card: "bg-jx-blue-tint", ink: "text-jx-blue-ink" },
  { card: "bg-jx-gold-tint", ink: "text-jx-gold-ink" },
  { card: "bg-jx-surface", ink: "text-jx-ink-2" },
] as const;

function money(value: string | number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
}
function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const dateValue = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const [year, month, day] = dateValue.split("-").map(Number);
  return year && month && day ? format(new Date(year, month - 1, day), "MMM d, yyyy") : "—";
}
function SkeletonCard({ tint }: { tint: string }) {
  return <div aria-hidden="true" className={`animate-pulse min-h-[150px] rounded-[26px] p-5 ${tint}`}><div className="h-4 w-1/2 rounded bg-card/70" /><div className="mt-6 h-8 w-2/3 rounded bg-card/70" /><div className="mt-3 h-3 w-1/3 rounded bg-card/60" /></div>;
}

export default function Materials() {
  const { toast } = useToast();
  const [jobFilter, setJobFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<MaterialWithJob | null>(null);
  const [deletingMaterial, setDeletingMaterial] = useState<MaterialWithJob | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const { data: materials, isLoading, isError: materialsError, isFetching: materialsFetching, refetch: retryMaterials } = useQuery<MaterialWithJob[]>({ queryKey: ["/api/materials"] });
  const { data: jobs, isLoading: jobsLoading, isError: jobsError, isFetching: jobsFetching, refetch: retryJobs } = useQuery<Job[]>({ queryKey: ["/api/jobs"] });
  const safeMaterials = materials ?? [];
  const safeJobs = jobs ?? [];
  const now = new Date();
  const monthName = format(now, "MMMM yyyy");
  const monthOnly = format(now, "MMMM");
  const summary = useMemo(() => monthlyMaterialSummary(safeMaterials, now.getFullYear(), now.getMonth()), [safeMaterials, now.getFullYear(), now.getMonth()]);
  const filteredMaterials = useMemo(() => filterMaterials(safeMaterials, jobFilter, search), [safeMaterials, jobFilter, search]);
  const filteredTotal = useMemo(() => totalMaterialPrice(filteredMaterials), [filteredMaterials]);
  const selectedJob = safeJobs.find((job) => job.id === jobFilter);
  const totalLabel = jobFilter === "unassigned" ? "Unassigned · all dates" : selectedJob ? `${selectedJob.title} · all dates` : search || jobFilter !== "all" ? "Filtered · all dates" : "All purchases · all dates";
  const activeFilter = jobFilter !== "all" || !!search.trim();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/materials/${id}`); },
    onSuccess: () => {
      invalidateMaterialTotals(queryClient);
      trackEvent("material_deleted");
      toast({ title: "Purchase deleted" });
      setDeletingMaterial(null);
      setDeleteError("");
    },
    onError: (error: Error) => {
      setDeleteError(error.message || "Could not delete this purchase. Try again.");
      toast({ title: "Could not delete purchase", description: error.message, variant: "destructive" });
    },
  });
  function openNew() { setEditingMaterial(null); setDialogOpen(true); }
  function openEdit(material: MaterialWithJob) { setEditingMaterial(material); setDialogOpen(true); }
  const openDelete = (material: MaterialWithJob) => { setDeleteError(""); setDeletingMaterial(material); };
  const closeForm = (open: boolean) => { setDialogOpen(open); if (!open) setEditingMaterial(null); };

  return <main className="min-h-[100dvh] min-w-0 px-4 pb-12 pt-7 text-jx-ink sm:px-7 sm:pt-9 xl:px-10">
    <div className="mx-auto flex w-full max-w-[1440px] min-w-0 flex-col gap-6 sm:gap-7">
      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className="font-display text-[48px] !font-bold leading-[.95] tracking-[-.055em] text-jx-ink sm:text-[64px]" data-testid="heading-materials">Materials</h1>
          <p className="mt-3 text-[15px] text-jx-ink-2 sm:text-[17px]">
            {isLoading ? "Loading purchase totals…" : materialsError ? "Purchase totals are unavailable" : `${monthName} purchases across ${summary.jobs.length} ${summary.jobs.length === 1 ? "job" : "jobs"}${summary.unassigned.count ? " and unassigned purchases" : ""}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" onClick={() => setScanOpen(true)} className="min-h-12 rounded-full border-2 border-jx-ink px-6 text-xs font-bold tracking-[.08em] text-jx-ink sm:px-7 sm:text-sm" data-testid="button-scan-receipt">
            <ScanLine className="mr-2 h-4 w-4" aria-hidden="true" /> SCAN RECEIPT
          </Button>
          <Button type="button" onClick={openNew} className="min-h-12 rounded-full bg-jx-green px-6 text-xs font-bold tracking-[.08em] text-white hover:bg-jx-green-hover sm:px-7 sm:text-sm" data-testid="button-add-material">
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" /> LOG PURCHASE
          </Button>
        </div>
      </header>

      <section aria-label={`${monthName} purchase totals`} className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="materials-monthly-summary">
        {isLoading ? [0, 1, 2].map((item) => <SkeletonCard key={item} tint={item ? "bg-jx-surface" : "bg-jx-blue-tint"} />) : materialsError ? (
          <div className="col-span-full flex flex-wrap items-center justify-between gap-4 rounded-[24px] bg-jx-orange-tint p-5 text-jx-orange-ink" role="alert" data-testid="materials-error">
            <div><h2 className="font-display text-xl !font-bold">Purchases didn’t load</h2><p className="mt-1 text-sm">Your monthly totals and purchase list are unavailable. Try again.</p></div>
            <Button type="button" variant="outline" className="min-h-11 rounded-full border-2 border-current px-5 text-current" onClick={() => void retryMaterials()} disabled={materialsFetching} data-testid="button-retry-materials">{materialsFetching ? "Trying again…" : "Retry"}</Button>
          </div>
        ) : <>
          <article className="min-h-[164px] rounded-[26px] bg-jx-blue px-6 py-5 text-white sm:px-7">
            <Package className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
            <p className="mt-5 text-sm font-medium text-white/85">Spent in {monthOnly}</p>
            <p className="mt-1 font-mono text-[36px] leading-tight tracking-[-.045em] tabular-nums sm:text-[40px]" data-testid="stat-materials-monthly">{money(summary.total)}</p>
            <p className="mt-1 text-xs text-white/75">{monthName} · {safeMaterials.filter((item) => item.purchaseDate.slice(0, 7) === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`).length} purchases</p>
          </article>
          {summary.jobs.map((job, index) => <article key={job.id} className={`min-h-[164px] rounded-[26px] p-6 sm:px-7 ${CARD_TINTS[index % CARD_TINTS.length].card}`} data-testid={`material-job-summary-${job.id}`}>
            <h2 className={`line-clamp-2 min-h-10 font-display text-[17px] !font-bold leading-snug tracking-[-.025em] text-jx-ink`}>{job.title}</h2>
            <p className="mt-1 text-sm text-jx-ink-2">{job.count} {job.count === 1 ? "purchase" : "purchases"} · {monthOnly}</p>
            <p className={`mt-1 font-mono text-[30px] leading-tight tracking-[-.04em] tabular-nums ${CARD_TINTS[index % CARD_TINTS.length].ink}`} data-testid={`material-job-monthly-total-${job.id}`}>{money(job.total)}</p>
          </article>)}
          {summary.unassigned.count > 0 && <article className="min-h-[164px] rounded-[26px] bg-jx-surface p-6 sm:px-7" data-testid="material-job-summary-unassigned">
            <h2 className="font-display text-[17px] !font-bold text-jx-ink">Unassigned purchases</h2>
            <p className="mt-2 text-sm text-jx-ink-2">{summary.unassigned.count} {summary.unassigned.count === 1 ? "purchase" : "purchases"} · {monthOnly}</p>
            <p className="mt-1 font-mono text-[30px] leading-tight tracking-[-.04em] tabular-nums text-jx-ink" data-testid="material-job-monthly-total-unassigned">{money(summary.unassigned.total)}</p>
          </article>}
          {summary.jobs.length === 0 && summary.unassigned.count === 0 && <div className="flex min-h-[164px] items-center rounded-[26px] bg-jx-surface px-6 text-sm text-jx-ink-2">No purchases recorded in {monthName} yet.</div>}
        </>}
      </section>
      {!materialsError && !isLoading && <p className="-mt-3 text-xs text-jx-ink-3">Monthly cards include this month only. The purchase table below keeps all dates.</p>}

      <section aria-label="Search and filter purchases" className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-full border-2 border-transparent bg-jx-surface px-4 focus-within:border-jx-green sm:max-w-[460px]">
          <Search className="h-4 w-4 shrink-0 text-jx-ink-3" aria-hidden="true" />
          <input type="search" aria-label="Search materials, description, vendor, or job" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search materials, vendors, or jobs" className="min-w-0 flex-1 bg-transparent text-sm text-jx-ink outline-none placeholder:text-jx-ink-3" data-testid="input-search-materials" />
        </div>
        <Select value={jobFilter} onValueChange={setJobFilter} disabled={jobsLoading || jobsError}>
          <SelectTrigger className="min-h-12 w-full rounded-full border-2 border-jx-line bg-card px-5 text-jx-ink sm:w-[250px]" data-testid="select-filter-material-job"><SelectValue placeholder={jobsError ? "Jobs unavailable" : "Filter by job"} /></SelectTrigger>
          <SelectContent><SelectItem value="all">All jobs</SelectItem><SelectItem value="unassigned">Unassigned</SelectItem>{safeJobs.map((job) => <SelectItem key={job.id} value={job.id}>{job.title}</SelectItem>)}</SelectContent>
        </Select>
        {jobsLoading && <span role="status" className="text-sm text-jx-ink-2">Loading jobs…</span>}
        {jobsError && <div role="alert" className="flex items-center gap-2 text-sm text-jx-orange-ink">Job filter unavailable <button type="button" className="min-h-11 underline" onClick={() => void retryJobs()} disabled={jobsFetching}>Retry</button></div>}
        {activeFilter && <Button type="button" variant="ghost" className="min-h-11 rounded-full px-4 text-jx-ink-2" onClick={() => { setJobFilter("all"); setSearch(""); }}>Clear filters</Button>}
      </section>

      <section className="min-w-0 overflow-hidden rounded-[24px] border border-jx-line bg-card" data-testid="materials-table-container">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-jx-line bg-jx-surface px-4 py-3.5 sm:px-5">
          <div><span className="text-sm font-semibold text-jx-ink">{isLoading || materialsError ? "Purchase history" : `${filteredMaterials.length} ${filteredMaterials.length === 1 ? "purchase" : "purchases"}`}</span><span className="ml-2 text-xs text-jx-ink-2">All dates</span></div>
          <div className="flex items-center gap-3">
            <div className="text-right"><div className="text-[10px] font-bold uppercase tracking-[.12em] text-jx-ink-3">{totalLabel}</div><div className="font-mono text-base font-semibold tabular-nums text-jx-ink" data-testid="text-material-total">{isLoading || materialsError ? "—" : money(filteredTotal)}</div></div>
          </div>
        </div>
        {isLoading ? <div className="space-y-3 p-5" aria-label="Loading purchases" data-testid="materials-loading">{[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-jx-surface" />)}</div>
          : materialsError ? <div className="flex min-h-48 flex-col items-center justify-center px-5 text-center text-jx-ink-2"><AlertTriangle className="mb-3 h-6 w-6 text-jx-orange-ink" aria-hidden="true" /><p className="font-semibold text-jx-ink">Purchase history is unavailable</p><p className="mt-1 text-sm">The list couldn’t be loaded. Use Retry above to check again.</p></div>
          : filteredMaterials.length === 0 ? <div className="flex min-h-56 flex-col items-center justify-center px-6 py-12 text-center" data-testid={safeMaterials.length ? "materials-no-matches" : "materials-empty"}>
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-jx-green-tint text-jx-green-ink">{safeMaterials.length ? <Search className="h-6 w-6" aria-hidden="true" /> : <Package className="h-6 w-6" aria-hidden="true" />}</div>
            <h2 className="font-display text-2xl !font-bold text-jx-ink">{safeMaterials.length ? "No matching purchases" : "No purchases yet"}</h2>
            <p className="mt-2 max-w-sm text-sm text-jx-ink-2">{safeMaterials.length ? "Try a different search or job filter. Older purchases remain available in this table." : "Log a material purchase to start tracking what each job costs."}</p>
            {safeMaterials.length ? <Button type="button" variant="outline" className="mt-4 min-h-11 rounded-full border-2 border-jx-ink px-5" onClick={() => { setJobFilter("all"); setSearch(""); }}>Clear filters</Button> : <Button type="button" className="mt-4 min-h-11 rounded-full bg-jx-green px-5 font-bold text-white" onClick={openNew}><Plus className="mr-2 h-4 w-4" /> Log purchase</Button>}
          </div> : <div className="relative w-full overflow-x-auto" data-testid="materials-table-scroll">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="border-b border-jx-line bg-card text-left text-[11px] font-bold uppercase tracking-[.1em] text-jx-ink-3"><tr>
                <th className="px-5 py-4">Material</th><th className="px-4 py-4">Job</th><th className="px-4 py-4">Vendor</th><th className="whitespace-nowrap px-4 py-4">Date</th><th className="whitespace-nowrap px-4 py-4 text-right">Qty</th><th className="whitespace-nowrap px-4 py-4 text-right">Price</th><th className="whitespace-nowrap px-4 py-4 text-right">Total</th><th className="w-28 px-4 py-4"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody className="divide-y divide-jx-line/70">
                {filteredMaterials.map((material, index) => {
                  const tint = CARD_TINTS[index % CARD_TINTS.length];
                  const qty = Number(material.quantity);
                  const storedTotal = Number(material.price);
                  const derivedUnitPrice = qty ? storedTotal / qty : 0;
                  return <tr key={material.id} className="transition-colors hover:bg-jx-surface/70" data-testid={`row-material-${material.id}`}>
                    <td className="max-w-[280px] px-5 py-4"><div className="font-semibold text-jx-ink">{material.name}</div>{material.description && <div className="mt-0.5 truncate text-xs text-jx-ink-2">{material.description}</div>}</td>
                    <td className="px-4 py-4"><span className="inline-flex max-w-[180px] items-center gap-2"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${material.job ? tint.ink.replace("text-", "bg-") : "bg-jx-ink-3"}`} aria-hidden="true" /><span className="truncate font-medium text-jx-ink">{material.job?.title ?? "Unassigned"}</span></span></td>
                    <td className="max-w-[160px] truncate px-4 py-4 text-jx-ink-2">{material.vendor || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-jx-ink-2">{formatDate(material.purchaseDate)}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-right text-jx-ink">{material.quantity} {material.unit}</td>
                    <td className="whitespace-nowrap px-4 py-4 text-right"><span className="font-mono text-jx-ink-2" data-testid={`cell-material-unitprice-${material.id}`}>{money(derivedUnitPrice)}</span><span className="mt-0.5 block text-[10px] text-jx-ink-3">calc. / unit</span></td>
                    <td className="whitespace-nowrap px-4 py-4 text-right font-mono font-semibold tabular-nums text-jx-ink" data-testid={`cell-material-total-${material.id}`}>{money(storedTotal)}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-1">
                      <Button type="button" variant="ghost" size="icon" className="h-11 w-11 rounded-full" onClick={() => openEdit(material)} aria-label={`Edit ${material.name}`} data-testid={`button-edit-material-${material.id}`}><Edit className="h-4 w-4" aria-hidden="true" /></Button>
                      <Button type="button" variant="ghost" size="icon" className="h-11 w-11 rounded-full text-jx-orange-ink hover:bg-jx-orange-tint" onClick={() => openDelete(material)} aria-label={`Delete ${material.name}`} data-testid={`button-delete-material-${material.id}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                    </div></td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>}
      </section>
    </div>

    <ReceiptScanDialog open={scanOpen} onOpenChange={setScanOpen} jobs={safeJobs} jobsLoading={jobsLoading} jobsError={jobsError} />
    <MaterialFormDialog key={editingMaterial?.id ?? "new"} open={dialogOpen} onOpenChange={closeForm} material={editingMaterial} jobs={safeJobs} jobsLoading={jobsLoading} jobsError={jobsError} jobsRetry={() => void retryJobs()} />
    <AlertDialog open={!!deletingMaterial} onOpenChange={(open) => { if (!open && !deleteMutation.isPending) { setDeletingMaterial(null); setDeleteError(""); } }}>
      <AlertDialogContent className="rounded-[26px] border-jx-line bg-card text-jx-ink">
        <AlertDialogHeader>
          <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-2xl bg-jx-orange-tint text-jx-orange-ink"><Trash2 className="h-5 w-5" aria-hidden="true" /></div>
          <AlertDialogTitle className="font-display text-2xl !font-bold text-jx-ink">Delete this purchase?</AlertDialogTitle>
          <AlertDialogDescription className="text-jx-ink-2">Permanently remove <strong className="text-jx-ink">{deletingMaterial?.name}</strong> from the purchase history. This can’t be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        {deleteError && <p className="rounded-xl bg-jx-orange-tint px-4 py-3 text-sm text-jx-orange-ink" role="alert">{deleteError}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleteMutation.isPending} className="min-h-11 rounded-full" data-testid="button-cancel-delete-material">Cancel</AlertDialogCancel>
          <AlertDialogAction className="min-h-11 rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleteMutation.isPending} onClick={(event) => { event.preventDefault(); if (deletingMaterial && !deleteMutation.isPending) { setDeleteError(""); deleteMutation.mutate(deletingMaterial.id); } }} data-testid="button-confirm-delete-material">{deleteMutation.isPending ? "Deleting…" : "Delete purchase"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </main>;
}
