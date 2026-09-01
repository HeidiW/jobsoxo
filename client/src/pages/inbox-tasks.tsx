import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";
import { differenceInDays, formatDistanceToNow } from "date-fns";
import type { Invoice, ChangeOrder, Job, Client, InboxTask } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronDown, ChevronRight, Clock, X, Trash2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
type TaskType = "invoice" | "change" | "schedule" | "client";

interface ActionTask {
  id: string;
  type: TaskType;
  title: string;
  context: string;
  ageDays: number;
  high: boolean;
  actionLabel: string;
  actionPrimary: boolean;
  href: string;
  invoiceId?: string; // for "send reminder" mutation
}

interface InvoiceWithRelations extends Invoice { client?: Client; }
interface ChangeOrderWithRelations extends ChangeOrder { invoice?: Invoice & { client?: Client }; job?: Job; }
interface JobWithRelations extends Job { client?: Client; }

// ── Design tokens per type ────────────────────────────────────────────────────
const TYPE_CONFIG: Record<TaskType, { bg: string; fg: string; glyph: string }> = {
  invoice:  { bg: "var(--b-red-bg)",    fg: "var(--b-red-fg)",    glyph: "$" },
  change:   { bg: "var(--b-amber-bg)",  fg: "var(--b-amber-fg)",  glyph: "±" },
  schedule: { bg: "var(--b-blue-bg)",   fg: "var(--b-blue-fg)",   glyph: "◷" },
  client:   { bg: "var(--b-purple-bg)", fg: "var(--b-purple-fg)", glyph: "☺" },
};

const FILTER_LABELS: { key: TaskType | "all"; label: string }[] = [
  { key: "all",      label: "All" },
  { key: "invoice",  label: "Invoices" },
  { key: "change",   label: "Change orders" },
  { key: "schedule", label: "Scheduling" },
  { key: "client",   label: "Clients" },
];

// ── Age formatting ────────────────────────────────────────────────────────────
function ageLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "1d";
  return `${days}d`;
}

function fmt(n: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(Number(n ?? 0));
}

// ── Dismiss persistence ───────────────────────────────────────────────────────
const DISMISS_KEY = "jobsoxo-inbox-dismissed";
function loadDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]")); } catch { return new Set(); }
}
function saveDismissed(ids: Set<string>) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...ids])); } catch {}
}

// ── HiddenTaskRow ─────────────────────────────────────────────────────────────
function HiddenTaskRow({
  task,
  onRestore,
  onDelete,
  isSelected,
  onToggleSelect,
}: {
  task: InboxTask;
  onRestore: (emailId: string) => void;
  onDelete: (emailId: string) => void;
  isSelected?: boolean;
  onToggleSelect?: (emailId: string) => void;
}) {
  const ago = formatDistanceToNow(new Date(task.receivedAt), { addSuffix: true });
  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/40 transition-colors"
      data-testid={`hidden-row-${task.emailId}`}
    >
      {onToggleSelect && (
        <Checkbox
          checked={isSelected ?? false}
          onCheckedChange={() => onToggleSelect(task.emailId)}
          className="h-3.5 w-3.5 shrink-0"
          data-testid={`checkbox-hidden-${task.emailId}`}
        />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-muted-foreground line-through"
          data-testid={`hidden-subject-${task.emailId}`}>
          {task.subject}
        </p>
        <p className="text-xs text-muted-foreground/70 truncate">
          {task.sender} · {ago}
        </p>
      </div>
      <button
        onClick={() => onRestore(task.emailId)}
        className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded-md border border-border bg-background hover:bg-muted transition-colors"
        data-testid={`button-restore-${task.emailId}`}
      >
        Restore
      </button>
      <button
        onClick={() => onDelete(task.emailId)}
        className="shrink-0 p-1 rounded text-muted-foreground/50 hover:text-destructive transition-colors"
        title="Delete permanently"
        data-testid={`button-delete-${task.emailId}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function InboxTasks() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<TaskType | "all">("all");
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  const [showHidden, setShowHidden] = useState(false);
  const [selectedDismissedIds, setSelectedDismissedIds] = useState<Set<string>>(new Set());
  const [showDeleteSelectedDialog, setShowDeleteSelectedDialog] = useState(false);
  const [showClearDismissedDialog, setShowClearDismissedDialog] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail_connected") === "1") {
      trackEvent("gmail_connected", { location: "inbox_tasks" });
      params.delete("gmail_connected");
      const query = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
  }, []);

  // Persist dismissed IDs to localStorage
  useEffect(() => { saveDismissed(dismissed); }, [dismissed]);

  // ── Data fetches ──────────────────────────────────────────────────────────
  const { data: invoices = [], isLoading: invLoading }
    = useQuery<InvoiceWithRelations[]>({ queryKey: ["/api/invoices"] });
  const { data: changeOrders = [], isLoading: coLoading }
    = useQuery<ChangeOrderWithRelations[]>({ queryKey: ["/api/change-orders"] });
  const { data: jobs = [], isLoading: jobsLoading }
    = useQuery<JobWithRelations[]>({ queryKey: ["/api/jobs"] });
  const { data: clients = [], isLoading: clientsLoading }
    = useQuery<Client[]>({ queryKey: ["/api/clients"] });

  const isLoading = invLoading || coLoading || jobsLoading || clientsLoading;

  // Gmail connection status
  const { data: gmailStatus } = useQuery<{ connected: boolean; email: string | null }>({
    queryKey: ["/api/inbox/status"],
  });
  const connected = gmailStatus?.connected ?? false;

  // Hidden inbox tasks (dismissed + snoozed Gmail emails)
  const { data: hiddenTasks = [], isLoading: hiddenLoading } = useQuery<InboxTask[]>({
    queryKey: ["/api/inbox/tasks/hidden"],
    enabled: connected,
    refetchInterval: 60_000,
  });

  // ── Send-reminder mutation ─────────────────────────────────────────────────
  const sendReminderMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await apiRequest("POST", `/api/invoices/${invoiceId}/send`);
      return res.json();
    },
    onSuccess: (_, invoiceId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      toast({ title: "Reminder sent", description: "Invoice reminder emailed to the client." });
      dismissTask(`invoice-overdue-${invoiceId}`);
    },
    onError: () => toast({ title: "Failed to send reminder", variant: "destructive" }),
  });

  // ── Dismiss helpers ───────────────────────────────────────────────────────
  function dismissTask(id: string) {
    setDismissed(prev => { const next = new Set(prev); next.add(id); return next; });
  }
  function markAllDone() {
    const ids = allTasks.map(t => t.id);
    setDismissed(prev => { const next = new Set(prev); ids.forEach(id => next.add(id)); return next; });
    toast({ title: "All tasks dismissed" });
  }

  // ── Derive tasks from real data ───────────────────────────────────────────
  const allTasks = useMemo((): ActionTask[] => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tasks: ActionTask[] = [];

    // ── Invoice tasks ────────────────────────────────────────────────────────
    for (const inv of invoices) {
      const due = inv.dueDate ? new Date(inv.dueDate) : null;
      const ageDays = due ? differenceInDays(today, due) : 0;
      const clientName = inv.client?.name ?? inv.clientId ?? "Client";
      const num = inv.invoiceNumber ?? inv.id.slice(0, 8).toUpperCase();

      // Overdue
      if ((inv.status === "sent" || inv.status === "overdue") && due && due < today) {
        tasks.push({
          id: `invoice-overdue-${inv.id}`,
          type: "invoice",
          title: `${num} is ${ageDays} day${ageDays !== 1 ? "s" : ""} overdue`,
          context: `${clientName} · ${fmt(inv.total)}`,
          ageDays,
          high: ageDays >= 7,
          actionLabel: "Send reminder",
          actionPrimary: ageDays >= 7,
          href: "/invoices",
          invoiceId: inv.id,
        });
        continue;
      }
      // Due today / partially paid
      if (inv.status === "partial" && due) {
        const balance = Number(inv.total) - Number(inv.amountPaid ?? 0);
        tasks.push({
          id: `invoice-partial-${inv.id}`,
          type: "invoice",
          title: `${clientName} balance due${differenceInDays(today, due) === 0 ? " today" : ""}`,
          context: `${num} · ${fmt(balance)} · partially paid`,
          ageDays: Math.max(0, differenceInDays(today, new Date(inv.createdAt))),
          high: false,
          actionLabel: "Send reminder",
          actionPrimary: false,
          href: "/invoices",
          invoiceId: inv.id,
        });
        continue;
      }
      // Draft — not yet sent
      if (inv.status === "draft") {
        const created = new Date(inv.createdAt);
        const staleDays = differenceInDays(today, created);
        if (staleDays >= 1) {
          tasks.push({
            id: `invoice-draft-${inv.id}`,
            type: "invoice",
            title: `${num} is still a draft`,
            context: `${clientName} · ${fmt(inv.total)}`,
            ageDays: staleDays,
            high: false,
            actionLabel: "Finish & send",
            actionPrimary: false,
            href: "/invoices",
          });
        }
      }
    }

    // ── Change order tasks ────────────────────────────────────────────────────
    for (const co of changeOrders) {
      if (co.status !== "pending") continue;
      const created = new Date(co.createdAt);
      const ageDays = differenceInDays(today, created);
      const jobName = co.job?.title ?? co.invoice?.client?.name ?? "Job";
      const coNum = co.id.slice(0, 8).toUpperCase();
      const sign = Number(co.amount) >= 0 ? "+" : "";
      tasks.push({
        id: `change-${co.id}`,
        type: "change",
        title: `${coNum} awaiting your approval`,
        context: `${jobName} · ${sign}${fmt(co.amount)}`,
        ageDays,
        high: ageDays >= 2,
        actionLabel: "Review",
        actionPrimary: ageDays >= 2,
        href: "/change-orders",
      });
    }

    // ── Scheduling tasks ──────────────────────────────────────────────────────
    for (const job of jobs) {
      if (job.status === "completed") continue;
      if (!job.startDate) {
        const created = new Date(job.createdAt);
        const ageDays = differenceInDays(today, created);
        const clientName = job.client?.name ?? "Client";
        tasks.push({
          id: `schedule-${job.id}`,
          type: "schedule",
          title: `${job.title} has no crew assigned`,
          context: `${clientName}${job.address ? ` · ${job.address}` : ""}`,
          ageDays,
          high: false,
          actionLabel: "Assign crew",
          actionPrimary: false,
          href: "/scheduling",
        });
      }
    }

    // ── Client tasks ──────────────────────────────────────────────────────────
    for (const client of clients) {
      const created = new Date(client.createdAt);
      const ageDays = differenceInDays(today, created);
      // New clients (within 7 days, no invoices yet)
      if (ageDays <= 7) {
        const hasInvoice = invoices.some(inv => inv.clientId === client.id);
        if (!hasInvoice) {
          tasks.push({
            id: `client-${client.id}`,
            type: "client",
            title: `New client: ${client.name}`,
            context: client.email
              ? `${client.email}${client.phone ? ` · ${client.phone}` : ""}`
              : client.phone ?? "No contact info",
            ageDays,
            high: false,
            actionLabel: "View",
            actionPrimary: false,
            href: "/clients",
          });
        }
      }
    }

    // Sort: high priority first, then by ageDays descending
    return tasks.sort((a, b) => {
      if (a.high !== b.high) return a.high ? -1 : 1;
      return b.ageDays - a.ageDays;
    });
  }, [invoices, changeOrders, jobs, clients]);

  // Active = not dismissed
  const activeTasks = useMemo(() => allTasks.filter(t => !dismissed.has(t.id)), [allTasks, dismissed]);

  // Filtered
  const filtered = useMemo(() =>
    filter === "all" ? activeTasks : activeTasks.filter(t => t.type === filter),
    [activeTasks, filter]);

  // Counts per type (of active tasks)
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: activeTasks.length };
    for (const t of activeTasks) m[t.type] = (m[t.type] ?? 0) + 1;
    return m;
  }, [activeTasks]);

  // ── Action handler ────────────────────────────────────────────────────────
  function handleAction(task: ActionTask) {
    if (task.type === "invoice" && task.actionLabel === "Send reminder" && task.invoiceId) {
      sendReminderMutation.mutate(task.invoiceId);
    } else {
      // Navigation-based — dismiss the task and toast
      dismissTask(task.id);
    }
  }

  // ── Hidden email handlers ─────────────────────────────────────────────────
  function handleRestore(emailId: string) {
    queryClient.setQueryData(["/api/inbox/tasks/hidden"], (old: InboxTask[] = []) =>
      old.filter(t => t.emailId !== emailId)
    );
    queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks"] });
    apiRequest("PATCH", `/api/inbox/tasks/${emailId}/restore`).catch(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      toast({ title: "Couldn't restore email", variant: "destructive" });
    });
  }

  function handleDelete(emailId: string) {
    queryClient.setQueryData(["/api/inbox/tasks/hidden"], (old: InboxTask[] = []) =>
      old.filter(t => t.emailId !== emailId)
    );
    apiRequest("DELETE", `/api/inbox/tasks/${emailId}`).catch(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      toast({ title: "Couldn't delete email", variant: "destructive" });
    });
  }

  function handleToggleSelectDismissed(emailId: string) {
    setSelectedDismissedIds(prev => {
      const next = new Set(prev);
      if (next.has(emailId)) next.delete(emailId); else next.add(emailId);
      return next;
    });
  }

  function handleDeleteSelected() {
    const ids = [...selectedDismissedIds];
    queryClient.setQueryData(["/api/inbox/tasks/hidden"], (old: InboxTask[] = []) =>
      old.filter(t => !selectedDismissedIds.has(t.emailId))
    );
    setSelectedDismissedIds(new Set());
    setShowDeleteSelectedDialog(false);
    Promise.all(ids.map(id => apiRequest("DELETE", `/api/inbox/tasks/${id}`))).catch(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      toast({ title: "Some emails couldn't be deleted", variant: "destructive" });
    });
  }

  function handleClearAllDismissed() {
    const ids = hiddenTasks.filter(t => t.dismissed).map(t => t.emailId);
    queryClient.setQueryData(["/api/inbox/tasks/hidden"], (old: InboxTask[] = []) =>
      old.filter(t => !t.dismissed)
    );
    setSelectedDismissedIds(new Set());
    setShowClearDismissedDialog(false);
    Promise.all(ids.map(id => apiRequest("DELETE", `/api/inbox/tasks/${id}`))).catch(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      toast({ title: "Some emails couldn't be cleared", variant: "destructive" });
    });
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 26px 40px" }}>
      <div style={{ maxWidth: "920px", margin: "0 auto" }}>

        {/* ── Title row ── */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px", marginBottom: "20px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, letterSpacing: "-.02em" }}>Inbox Tasks</h2>
            <p style={{ margin: "5px 0 0", fontSize: "13.5px", color: "var(--muted)" }}>
              {isLoading
                ? "Loading…"
                : activeTasks.length === 0
                ? "You're all caught up"
                : `${activeTasks.length} thing${activeTasks.length !== 1 ? "s" : ""} need your attention`}
            </p>
          </div>
          <button
            onClick={markAllDone}
            disabled={activeTasks.length === 0}
            style={{ background: "var(--panel)", color: "var(--muted)", border: "1px solid var(--panel-bd)", borderRadius: "9px", padding: "9px 14px", fontSize: "13px", fontWeight: 600, cursor: activeTasks.length === 0 ? "default" : "pointer", fontFamily: "inherit", opacity: activeTasks.length === 0 ? 0.4 : 1 }}
            data-testid="button-mark-all-done">
            Mark all done
          </button>
        </div>

        {/* ── Filter tabs ── */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "16px", flexWrap: "wrap" }}>
          {FILTER_LABELS.map(f => {
            const active = filter === f.key;
            const count = counts[f.key] ?? 0;
            return (
              <button key={f.key} onClick={() => setFilter(f.key)}
                style={{ display: "inline-flex", alignItems: "center", gap: "7px", cursor: "pointer", fontFamily: "inherit", fontSize: "13px", fontWeight: 600, padding: "7px 13px", borderRadius: "8px", border: "1px solid " + (active ? "transparent" : "var(--panel-bd)"), background: active ? "var(--jox-primary)" : "var(--panel)", color: active ? "#fff" : "var(--muted)" }}
                data-testid={`filter-${f.key}`}>
                {f.label}
                {count > 0 && (
                  <span className="font-mono" style={{ fontSize: "11px", fontWeight: 600, padding: "0 6px", borderRadius: "5px", background: active ? "rgba(255,255,255,.22)" : "var(--track)", color: active ? "#fff" : "var(--faint)" }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Task list ── */}
        <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "12px", overflow: "hidden" }}>
          {isLoading && (
            <>
              {[1,2,3,4].map(i => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "14px", padding: "14px 18px", borderBottom: "1px solid var(--panel-bd)" }}>
                  <div style={{ width: "38px", height: "38px", borderRadius: "9px", background: "var(--track)", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ height: "13px", background: "var(--track)", borderRadius: "4px", width: "55%", marginBottom: "7px" }} />
                    <div style={{ height: "11px", background: "var(--track)", borderRadius: "4px", width: "40%" }} />
                  </div>
                  <div style={{ width: "80px", height: "30px", background: "var(--track)", borderRadius: "8px" }} />
                </div>
              ))}
            </>
          )}

          {!isLoading && filtered.length === 0 && filter !== "all" && (
            <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--faint)", fontSize: "13px" }}>
              No {FILTER_LABELS.find(f => f.key === filter)?.label.toLowerCase()} tasks right now.
            </div>
          )}

          {!isLoading && filtered.map((task, i) => {
            const cfg = TYPE_CONFIG[task.type];
            const isLast = i === filtered.length - 1;
            const isPendingReminder = sendReminderMutation.isPending && sendReminderMutation.variables === task.invoiceId;
            return (
              <div key={task.id} className="rowhover"
                style={{ display: "flex", alignItems: "center", gap: "14px", padding: "14px 18px", borderBottom: isLast ? "none" : "1px solid var(--panel-bd)" }}
                data-testid={`task-row-${task.id}`}>

                {/* Icon box */}
                <div style={{ width: "38px", height: "38px", borderRadius: "9px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: cfg.bg, color: cfg.fg, fontSize: "16px", fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace" }}>
                  {cfg.glyph}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {task.high && (
                      <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#d23b1f", flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: "13.5px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                      data-testid={`task-title-${task.id}`}>
                      {task.title}
                    </span>
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--faint)", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {task.context}
                  </div>
                </div>

                {/* Age */}
                <span style={{ fontSize: "11.5px", color: "var(--faint)", flexShrink: 0 }}>
                  {ageLabel(task.ageDays)}
                </span>

                {/* Action button */}
                {task.href && !task.invoiceId ? (
                  <Link href={task.href}>
                    <button onClick={() => dismissTask(task.id)}
                      style={{ flexShrink: 0, background: task.actionPrimary ? "var(--jox-primary)" : "var(--panel)", color: task.actionPrimary ? "#fff" : "var(--fg)", border: task.actionPrimary ? "none" : "1px solid var(--panel-bd)", borderRadius: "8px", padding: "7px 14px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
                      data-testid={`action-${task.id}`}>
                      {task.actionLabel}
                    </button>
                  </Link>
                ) : (
                  <button
                    onClick={() => handleAction(task)}
                    disabled={isPendingReminder}
                    style={{ flexShrink: 0, background: task.actionPrimary ? "var(--jox-primary)" : "var(--panel)", color: task.actionPrimary ? "#fff" : "var(--fg)", border: task.actionPrimary ? "none" : "1px solid var(--panel-bd)", borderRadius: "8px", padding: "7px 14px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap", opacity: isPendingReminder ? 0.6 : 1 }}
                    data-testid={`action-${task.id}`}>
                    {isPendingReminder ? "Sending…" : task.actionLabel}
                  </button>
                )}

                {/* Dismiss ×  */}
                <button onClick={() => dismissTask(task.id)}
                  title="Dismiss"
                  style={{ flexShrink: 0, border: "none", background: "none", cursor: "pointer", color: "var(--faint)", padding: "4px", display: "flex", alignItems: "center", borderRadius: "6px", opacity: 0.6, lineHeight: 1 }}
                  data-testid={`dismiss-${task.id}`}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            );
          })}

          {/* Footer */}
          <div style={{ padding: "14px 18px", textAlign: "center", borderTop: filtered.length > 0 && !isLoading ? "1px solid var(--panel-bd)" : "none" }}>
            <span style={{ fontSize: "12.5px", color: "var(--faint)" }}>
              {activeTasks.length === 0
                ? "You're all caught up. 🎉"
                : filter !== "all" && filtered.length === 0
                ? `No ${FILTER_LABELS.find(f => f.key === filter)?.label.toLowerCase()} tasks right now.`
                : "You're caught up on everything else. 🎉"}
            </span>
          </div>
        </div>

        {/* ── Dismissed tasks count ── */}
        {dismissed.size > 0 && (
          <div style={{ marginTop: "16px", textAlign: "center" }}>
            <button
              onClick={() => { setDismissed(new Set()); toast({ title: "All tasks restored" }); }}
              style={{ fontSize: "12px", color: "var(--faint)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: "3px" }}
              data-testid="button-restore-all">
              {dismissed.size} dismissed task{dismissed.size !== 1 ? "s" : ""} — restore all
            </button>
          </div>
        )}

      {/* Hidden emails — collapsible section */}
      {connected && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <button
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors flex-1 text-left px-1 py-1 rounded"
              onClick={() => setShowHidden((v) => !v)}
              data-testid="button-toggle-hidden"
            >
              {showHidden ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <span className="font-medium">Hidden emails</span>
              <span className="text-xs opacity-70">(dismissed &amp; snoozed)</span>
              {hiddenTasks.length > 0 && (() => {
                const now = new Date();
                const overdueCount = hiddenTasks.filter(
                  (t) => !t.dismissed && t.snoozedUntil != null && new Date(t.snoozedUntil) < now
                ).length;
                const snoozedCount = hiddenTasks.filter(
                  (t) => !t.dismissed && t.snoozedUntil != null
                ).length;
                const dismissedCount = hiddenTasks.filter((t) => t.dismissed).length;
                return (
                  <span
                    className="ml-1 flex items-center gap-1 text-xs text-muted-foreground"
                    data-testid="badge-hidden-count"
                  >
                    {overdueCount > 0 && (
                      <Badge
                        className="text-xs px-1.5 py-0 gap-1 bg-amber-500 hover:bg-amber-500 text-white border-0"
                        data-testid="badge-hidden-overdue-count"
                      >
                        <Clock className="h-3 w-3" />
                        {overdueCount} due now
                      </Badge>
                    )}
                    {snoozedCount > overdueCount && (
                      <Badge
                        variant="secondary"
                        className="text-xs px-1.5 py-0 gap-1"
                        data-testid="badge-hidden-snoozed-count"
                      >
                        <Clock className="h-3 w-3" />
                        {snoozedCount - overdueCount} snoozed
                      </Badge>
                    )}
                    {snoozedCount > 0 && dismissedCount > 0 && (
                      <span className="opacity-50">·</span>
                    )}
                    {dismissedCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="text-xs px-1.5 py-0 gap-1"
                        data-testid="badge-hidden-dismissed-count"
                      >
                        <X className="h-3 w-3" />
                        {dismissedCount} dismissed
                      </Badge>
                    )}
                  </span>
                );
              })()}
            </button>
            <div className="flex items-center gap-1 shrink-0">
              {selectedDismissedIds.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-destructive hover:text-destructive h-7 px-2"
                  onClick={() => setShowDeleteSelectedDialog(true)}
                  data-testid="button-delete-selected"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete selected ({selectedDismissedIds.size})
                </Button>
              )}
              {hiddenTasks.some((t) => t.dismissed) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground hover:text-destructive h-7 px-2"
                  onClick={() => setShowClearDismissedDialog(true)}
                  data-testid="button-clear-all-dismissed"
                >
                  Clear all {hiddenTasks.filter((t) => t.dismissed).length} dismissed
                </Button>
              )}
            </div>
          </div>

          {showHidden && (
            <Card className="mt-2">
              <CardContent className="pt-3 pb-2">
                {hiddenLoading ? (
                  <div className="space-y-2 py-2">
                    {[1, 2].map((i) => (
                      <div key={i} className="flex items-center gap-3 p-3">
                        <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-4 w-1/2" />
                          <Skeleton className="h-3 w-3/4" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : hiddenTasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No hidden emails right now.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {(() => {
                      const snoozedGroup = hiddenTasks.filter(
                        (t) => !t.dismissed && t.snoozedUntil != null
                      );
                      const dismissedGroup = hiddenTasks.filter(
                        (t) => t.dismissed
                      );
                      return (
                        <>
                          {snoozedGroup.length > 0 && (
                            <div>
                              <p
                                className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 pb-1"
                                data-testid="label-hidden-section-snoozed"
                              >
                                Snoozed
                              </p>
                              <div className="space-y-0.5">
                                {snoozedGroup.map((t) => (
                                  <HiddenTaskRow
                                    key={t.id}
                                    task={t}
                                    onRestore={handleRestore}
                                    onDelete={handleDelete}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                          {dismissedGroup.length > 0 && (
                            <div>
                              <div className="flex items-center justify-between px-1 pb-1">
                                <span
                                  className="text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                                  data-testid="label-hidden-section-dismissed"
                                >
                                  Dismissed
                                </span>
                                <label className="flex items-center gap-1.5 cursor-pointer select-none" data-testid="label-select-all-dismissed">
                                  <Checkbox
                                    data-testid="checkbox-select-all-dismissed"
                                    checked={
                                      selectedDismissedIds.size === dismissedGroup.length
                                        ? true
                                        : selectedDismissedIds.size > 0
                                        ? "indeterminate"
                                        : false
                                    }
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        setSelectedDismissedIds(new Set(dismissedGroup.map((t) => t.emailId)));
                                      } else {
                                        setSelectedDismissedIds(new Set());
                                      }
                                    }}
                                    className="h-3.5 w-3.5"
                                  />
                                  <span className="text-xs text-muted-foreground">Select all</span>
                                </label>
                              </div>
                              <div className="space-y-0.5">
                                {dismissedGroup.map((t) => (
                                  <HiddenTaskRow
                                    key={t.id}
                                    task={t}
                                    onRestore={handleRestore}
                                    onDelete={handleDelete}
                                    isSelected={selectedDismissedIds.has(t.emailId)}
                                    onToggleSelect={handleToggleSelectDismissed}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Footer hint */}
      {allTasks.length > 0 && (
        <p className="text-xs text-muted-foreground text-center mt-4">
          <Clock className="h-3 w-3 inline mr-1" />
          Click a row or checkbox to mark done · Hover a row for dismiss/snooze options
        </p>
      )}

      {/* ── Confirmation dialogs ── */}
      <AlertDialog open={showDeleteSelectedDialog} onOpenChange={setShowDeleteSelectedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedDismissedIds.size} email{selectedDismissedIds.size !== 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected emails from your hidden panel. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSelected} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showClearDismissedDialog} onOpenChange={setShowClearDismissedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all dismissed emails?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes all {hiddenTasks.filter(t => t.dismissed).length} dismissed emails. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearAllDismissed} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Clear all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  </div>
  );
}
