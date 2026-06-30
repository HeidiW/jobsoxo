import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Eye, Edit, Ruler, FileText, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import JobForm from "@/components/job-form";
import type { Job, Client } from "@shared/schema";

interface JobWithClient extends Job {
  client: Client;
}

// ── Design tokens ─────────────────────────────────────────────────────────────
type JobStatus = "quoted" | "scheduled" | "in_progress" | "completed" | string;

const STATUS_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  quoted:      { bg: "var(--b-gray-bg)",  fg: "var(--b-gray-fg)",  label: "Quoted" },
  scheduled:   { bg: "var(--b-blue-bg)",  fg: "var(--b-blue-fg)",  label: "Scheduled" },
  in_progress: { bg: "var(--b-amber-bg)", fg: "var(--b-amber-fg)", label: "In progress" },
  completed:   { bg: "var(--b-green-bg)", fg: "var(--b-green-fg)", label: "Completed" },
  on_hold:     { bg: "var(--b-gray-bg)",  fg: "var(--b-gray-fg)",  label: "On hold" },
};

const AV_BG = ["--av1", "--av2", "--av3", "--av4"];
const AV_FG = ["--av1f", "--av2f", "--av3f", "--av4f"];

// ── Helpers ───────────────────────────────────────────────────────────────────
function progressFromStatus(status: JobStatus): number {
  if (status === "completed") return 100;
  if (status === "in_progress") return 50;
  if (status === "scheduled") return 0;
  return 0; // quoted
}

function progressColor(pct: number, status: JobStatus): string {
  if (status === "completed") return "#15a35a";
  if (pct === 0) return "var(--faint)";
  return "var(--jox-primary)";
}

function fmtCurrency(v: string | number | null | undefined) {
  if (!v) return "$0";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(Number(v));
}

function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

// ── Filter defs ───────────────────────────────────────────────────────────────
type Filter = "all" | "in_progress" | "scheduled" | "completed";
const FILTER_DEFS: { key: Filter; label: string }[] = [
  { key: "all",         label: "All jobs" },
  { key: "in_progress", label: "In progress" },
  { key: "scheduled",   label: "Scheduled" },
  { key: "completed",   label: "Completed" },
];

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Jobs() {
  const [activeFilter, setActiveFilter] = useState<Filter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [deletingJob, setDeletingJob] = useState<JobWithClient | null>(null);
  const { toast } = useToast();

  const { data: jobs, isLoading } = useQuery<JobWithClient[]>({ queryKey: ["/api/jobs"] });

  const deleteJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      await apiRequest("DELETE", `/api/jobs/${jobId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: "Job deleted", description: `"${deletingJob?.title}" has been deleted.` });
      setDeletingJob(null);
    },
    onError: () => toast({ title: "Failed to delete job", variant: "destructive" }),
  });

  // ── Counts ──────────────────────────────────────────────────────────────────
  const all = jobs ?? [];
  const counts: Record<Filter, number> = {
    all:         all.length,
    in_progress: all.filter(j => j.status === "in_progress").length,
    scheduled:   all.filter(j => j.status === "scheduled").length,
    completed:   all.filter(j => j.status === "completed").length,
  };

  // ── Subtitle ──────────────────────────────────────────────────────────────────
  const activeCount    = counts.in_progress;
  const scheduledCount = counts.scheduled;
  const completedCount = counts.completed;
  const subtitle = isLoading
    ? "Loading jobs…"
    : `${activeCount} active · ${scheduledCount} scheduled · ${completedCount} completed`;

  // ── Filtered + searched ────────────────────────────────────────────────────
  const filtered = all
    .filter(j => activeFilter === "all" || j.status === activeFilter)
    .filter(j => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return j.title.toLowerCase().includes(q)
        || j.client?.name?.toLowerCase().includes(q)
        || j.address?.toLowerCase().includes(q);
    });

  // ── Open new or edit dialog ────────────────────────────────────────────────
  function openNew() { setEditingJob(null); setIsDialogOpen(true); }
  function openEdit(job: Job) { setEditingJob(job); setIsDialogOpen(true); }
  function closeDialog() { setIsDialogOpen(false); setEditingJob(null); }

  return (
    <>
      {/* ── New/Edit Job dialog ── */}
      <Dialog open={isDialogOpen} onOpenChange={open => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle style={{ fontSize: "17px", fontWeight: 800 }}>
              {editingJob ? "Edit job" : "New job"}
            </DialogTitle>
          </DialogHeader>
          <JobForm
            job={editingJob || undefined}
            onSuccess={() => {}}
            onClose={closeDialog}
          />
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ── */}
      <AlertDialog open={!!deletingJob} onOpenChange={o => { if (!o) setDeletingJob(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete job?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>"{deletingJob?.title}"</strong> and all associated invoices, line items, and documents. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingJob && deleteJobMutation.mutate(deletingJob.id)}
              disabled={deleteJobMutation.isPending}
              data-testid="button-confirm-delete-job"
            >
              {deleteJobMutation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Page body ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 26px 40px" }}>
        <div style={{ maxWidth: "1280px", margin: "0 auto" }}>

          {/* ── Title row ── */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px", marginBottom: "20px" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, letterSpacing: "-.02em" }}>Jobs</h2>
              <p style={{ margin: "5px 0 0", fontSize: "13.5px", color: "var(--muted)" }}>{subtitle}</p>
            </div>
            <button
              onClick={openNew}
              style={{ display: "flex", alignItems: "center", gap: "8px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "9px", padding: "10px 16px", fontSize: "13.5px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 1px 2px rgba(37,99,235,.3)" }}
              data-testid="button-add-job"
            >
              <Plus style={{ width: "16px", height: "16px" }} />
              New job
            </button>
          </div>

          {/* ── Filter tabs ── */}
          <div style={{ display: "flex", gap: "4px", marginBottom: "16px", flexWrap: "wrap" }}>
            {FILTER_DEFS.map(f => {
              const active = activeFilter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setActiveFilter(f.key)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "7px", cursor: "pointer",
                    fontFamily: "inherit", fontSize: "13px", fontWeight: 600, padding: "7px 13px", borderRadius: "8px",
                    border: "1px solid " + (active ? "transparent" : "var(--panel-bd)"),
                    background: active ? "var(--jox-primary)" : "var(--panel)",
                    color: active ? "#fff" : "var(--muted)",
                  }}
                  data-testid={`filter-tab-${f.key}`}
                >
                  {f.label}
                  <span
                    className="font-mono"
                    style={{
                      fontSize: "11px", fontWeight: 600, padding: "0 6px", borderRadius: "5px",
                      background: active ? "rgba(255,255,255,.22)" : "var(--track)",
                      color: active ? "#fff" : "var(--faint)",
                    }}
                  >
                    {counts[f.key]}
                  </span>
                </button>
              );
            })}
            {/* Inline search — faint, right-aligned */}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "7px", background: "var(--track)", border: "1px solid var(--panel-bd)", borderRadius: "8px", padding: "6px 11px", minWidth: "200px" }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search jobs…"
                style={{ border: "none", background: "none", outline: "none", fontSize: "12.5px", color: "var(--fg)", fontFamily: "inherit", width: "100%" }}
                data-testid="input-search-jobs"
              />
            </div>
          </div>

          {/* ── Table card ── */}
          <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "12px", overflow: "hidden" }}>

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", fontSize: "10.5px", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase" as const, color: "var(--faint)", padding: "11px 18px", background: "var(--track)", borderBottom: "1px solid var(--panel-bd)" }}>
              <span style={{ flex: 1, minWidth: 0 }}>Job / client</span>
              <span style={{ width: "116px", flexShrink: 0 }}>Progress</span>
              <span style={{ width: "92px", flexShrink: 0 }}>Crew</span>
              <span style={{ width: "100px", flexShrink: 0, textAlign: "right" as const }}>Value</span>
              <span style={{ width: "96px", flexShrink: 0, textAlign: "center" as const }}>Status</span>
              <span style={{ width: "24px", flexShrink: 0 }}></span>
            </div>

            {/* Loading skeleton */}
            {isLoading && (
              <div style={{ padding: "40px", textAlign: "center" as const, color: "var(--faint)", fontSize: "13px" }}>
                Loading jobs…
              </div>
            )}

            {/* Empty state */}
            {!isLoading && filtered.length === 0 && (
              <div style={{ padding: "56px 24px", textAlign: "center" as const }}>
                <div style={{ fontSize: "32px", marginBottom: "10px" }}>💼</div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--fg)", marginBottom: "4px" }}>
                  {searchQuery || activeFilter !== "all" ? "No jobs found" : "No jobs yet"}
                </div>
                <div style={{ fontSize: "13px", color: "var(--faint)", marginBottom: "16px" }}>
                  {searchQuery ? `No results for "${searchQuery}"` : activeFilter !== "all" ? "Try a different filter." : "Create your first job to get started."}
                </div>
                {!searchQuery && activeFilter === "all" && (
                  <button
                    onClick={openNew}
                    style={{ display: "inline-flex", alignItems: "center", gap: "7px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "9px", padding: "10px 18px", fontSize: "13px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                    data-testid="button-add-first-job"
                  >
                    <Plus style={{ width: "15px", height: "15px" }} /> New job
                  </button>
                )}
              </div>
            )}

            {/* Rows */}
            {!isLoading && filtered.map((job, i) => {
              const badge = STATUS_BADGE[job.status] ?? STATUS_BADGE.on_hold;
              const pct = progressFromStatus(job.status);
              const pColor = progressColor(pct, job.status);
              const avBg = `var(${AV_BG[i % 4]})`;
              const avFg = `var(${AV_FG[i % 4]})`;
              const clientName = job.client?.name ?? "Unknown";
              const location = job.address ?? "";

              return (
                <div
                  key={job.id}
                  className="rowhover"
                  style={{ display: "flex", alignItems: "center", padding: "13px 18px", borderBottom: "1px solid var(--panel-bd)" }}
                  data-testid={`row-job-${job.id}`}
                >
                  {/* Job / client */}
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "12px", paddingRight: "12px" }}>
                    {/* Avatar icon */}
                    <div style={{ width: "38px", height: "38px", borderRadius: "9px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: avBg, color: avFg }}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="7" width="20" height="14" rx="2"/>
                        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                      </svg>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "13.5px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        <Link href={`/jobs/${job.id}`} style={{ color: "inherit", textDecoration: "none" }} data-testid={`link-job-title-${job.id}`}>
                          {job.title}
                        </Link>
                      </div>
                      <div style={{ fontSize: "11.5px", color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {clientName}{location ? ` · ${location}` : ""}
                      </div>
                    </div>
                  </div>

                  {/* Progress */}
                  <div style={{ width: "116px", flexShrink: 0, paddingRight: "14px" }}>
                    <div style={{ height: "7px", borderRadius: "4px", background: "var(--track)", overflow: "hidden" }}>
                      <div style={{ width: `${pct}%`, height: "100%", background: pColor, transition: "width .3s" }} />
                    </div>
                    <div className="font-mono" style={{ fontSize: "10.5px", color: "var(--faint)", marginTop: "4px" }}>{pct}%</div>
                  </div>

                  {/* Crew — not in DB, show dash */}
                  <div style={{ width: "92px", flexShrink: 0, fontSize: "12.5px", color: "var(--muted)" }}>
                    —
                  </div>

                  {/* Value */}
                  <span className="font-mono" style={{ width: "100px", flexShrink: 0, textAlign: "right", fontSize: "13px", fontWeight: 600 }} data-testid={`value-job-${job.id}`}>
                    {fmtCurrency(job.estimatedTotal)}
                  </span>

                  {/* Status badge */}
                  <div style={{ width: "96px", flexShrink: 0, display: "flex", justifyContent: "center" }}>
                    <span style={{ background: badge.bg, color: badge.fg, fontSize: "11px", fontWeight: 600, padding: "3px 10px", borderRadius: "6px", textTransform: "capitalize", whiteSpace: "nowrap" }}>
                      {badge.label}
                    </span>
                  </div>

                  {/* Actions chevron → dropdown */}
                  <span style={{ width: "24px", flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          style={{ border: "none", background: "none", cursor: "pointer", color: "var(--faint)", padding: "2px 0", display: "flex", alignItems: "center" }}
                          data-testid={`button-job-actions-${job.id}`}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" sideOffset={4}>
                        <DropdownMenuItem asChild>
                          <Link href={`/jobs/${job.id}`} data-testid={`button-view-job-${job.id}`}>
                            <Eye className="h-4 w-4 mr-2" />View details
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEdit(job)} data-testid={`button-edit-job-${job.id}`}>
                          <Edit className="h-4 w-4 mr-2" />Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/jobs/${job.id}/line-items`} data-testid={`button-line-items-${job.id}`}>
                            <Ruler className="h-4 w-4 mr-2" />Line items
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href={`/invoices/new?jobId=${job.id}`} data-testid={`button-create-invoice-job-${job.id}`}>
                            <FileText className="h-4 w-4 mr-2" />Create invoice
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeletingJob(job)}
                          data-testid={`button-delete-job-${job.id}`}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </div>
              );
            })}

            {/* Footer */}
            {!isLoading && filtered.length > 0 && (
              <div style={{ padding: "13px 18px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: "12.5px", color: "var(--faint)" }}>
                  {filtered.length} job{filtered.length !== 1 ? "s" : ""}
                  {activeFilter !== "all" ? ` · ${FILTER_DEFS.find(f => f.key === activeFilter)?.label}` : ""}
                </span>
                <button
                  onClick={openNew}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", border: "1px solid var(--panel-bd)", background: "var(--panel)", color: "var(--jox-primary)", borderRadius: "8px", padding: "6px 14px", fontSize: "12.5px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
                  data-testid="button-new-job-footer"
                >
                  <Plus style={{ width: "13px", height: "13px" }} />New job
                </button>
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}
