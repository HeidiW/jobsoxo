import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isToday, format, differenceInDays } from "date-fns";
import type { InboxTask, Client } from "@shared/schema";
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
import { ArrowLeftRight, ChevronDown, ChevronUp, Mail, PlugZap, RefreshCw, Unplug } from "lucide-react";

// ── Color palette for client chips (7 buckets) ───────────────────────────────
const COLOR_KEYS = ["blue","green","amber","purple","pink","teal","gray"] as const;
type ColorKey = typeof COLOR_KEYS[number];
type AccountAction = "disconnect" | "switch";

function hashColor(str: string): ColorKey {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return COLOR_KEYS[Math.abs(h) % COLOR_KEYS.length];
}

function chipVars(color: ColorKey) {
  return {
    bg: `var(--b-${color}-bg)`,
    fg: `var(--b-${color}-fg)`,
  };
}

// ── Priority color ─────────────────────────────────────────────────────────
const PRIO: Record<string, string> = {
  high:   "#d23b1f",
  medium: "#e0a020",
  low:    "var(--faint)",
};

// ── Derive priority from task ──────────────────────────────────────────────
function taskPriority(t: InboxTask): "high" | "medium" | "low" {
  if (t.isDone) return "low";
  if (!t.isRead) return "high";
  return "medium";
}

// ── Match task sender to a client ─────────────────────────────────────────
function matchClient(t: InboxTask, clients: Client[]): Client | null {
  if (!clients.length) return null;
  if (t.senderEmail) {
    const m = clients.find(c => c.email && c.email.toLowerCase() === t.senderEmail!.toLowerCase());
    if (m) return m;
  }
  const senderLower = t.sender.toLowerCase();
  for (const c of clients) {
    const nameLower = c.name.toLowerCase();
    if (senderLower.includes(nameLower) || nameLower.includes(senderLower.split(" ")[0])) return c;
  }
  return null;
}

// ── Round checkbox ────────────────────────────────────────────────────────
function RoundCheck({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className="cbtn"
      style={{
        flexShrink: 0, width: "22px", height: "22px", marginTop: "1px",
        borderRadius: "50%", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all .15s",
        border: checked ? "none" : "2px solid var(--panel-bd)",
        background: checked ? "var(--jox-primary)" : "transparent",
      }}
      data-testid={`checkbox-toggle`}
    >
      {checked && (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}

// ── Sparkle SVG ──────────────────────────────────────────────────────────
function Sparkle() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="gemgrad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4285F4" />
          <stop offset="0.5" stopColor="#9b72cb" />
          <stop offset="1" stopColor="#d96570" />
        </linearGradient>
      </defs>
      <path d="M12 2c.4 4.5 3.5 7.6 8 8-4.5.4-7.6 3.5-8 8-.4-4.5-3.5-7.6-8-8 4.5-.4 7.6-3.5 8-8z" fill="url(#gemgrad)" />
    </svg>
  );
}

// ── Not-connected state ──────────────────────────────────────────────────
function NotConnected({ onConnect, connecting }: { onConnect: () => void; connecting: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 24px", textAlign: "center" }}>
      <div style={{ width: "56px", height: "56px", borderRadius: "50%", background: "var(--track)", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "20px" }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
        </svg>
      </div>
      <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>Connect your Gmail</h2>
      <p style={{ margin: "8px 0 0", fontSize: "13.5px", color: "var(--faint)", maxWidth: "340px", lineHeight: 1.6 }}>
        Connect your Gmail account to see today's client emails as actionable tasks.
      </p>
      <button
        onClick={onConnect}
        disabled={connecting}
        style={{ marginTop: "20px", display: "inline-flex", alignItems: "center", gap: "8px", background: "var(--jox-primary)", color: "#fff", border: "none", borderRadius: "10px", padding: "10px 18px", fontSize: "13.5px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
        data-testid="button-connect-gmail"
      >
        <PlugZap size={16} />
        {connecting ? "Redirecting…" : "Connect Gmail"}
      </button>
    </div>
  );
}

// ── Age label for dismissed emails ───────────────────────────────────────
function dismissedAgeLabel(receivedAt: string | Date): string {
  const days = differenceInDays(new Date(), new Date(receivedAt));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function GmailTodos() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>("all");
  const [connecting, setConnecting] = useState(false);
  const [accountAction, setAccountAction] = useState<AccountAction | null>(null);
  const [hiddenPanelOpen, setHiddenPanelOpen] = useState(false);
  const [selectedDismissedIds, setSelectedDismissedIds] = useState<Set<string>>(new Set());

  // OAuth redirect handling
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailConnected = params.get("gmail_connected");
    const gmailError = params.get("gmail_error");
    if (gmailConnected === "1") {
      toast({ title: "Gmail connected!", description: "Your inbox is syncing now." });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/status"] });
    } else if (gmailError) {
      const msg = gmailError === "access_denied"
        ? "Gmail access was denied. You can try again any time."
        : `Gmail connection error: ${gmailError}`;
      toast({ title: "Gmail connection failed", description: msg, variant: "destructive" });
    }
    if (gmailConnected || gmailError) {
      const url = new URL(window.location.href);
      url.searchParams.delete("gmail_connected");
      url.searchParams.delete("gmail_error");
      window.history.replaceState({}, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Connection status
  const { data: status, isLoading: statusLoading } = useQuery<{ connected: boolean; email: string | null }>({
    queryKey: ["/api/inbox/status"],
    refetchInterval: 30_000,
  });

  // Last-sync timestamp
  const { data: syncInfo } = useQuery<{ lastSyncedAt: string | null }>({
    queryKey: ["/api/inbox/last-sync"],
    enabled: status?.connected ?? false,
    refetchInterval: 60_000,
  });

  // Inbox tasks (all cached — we filter to today's)
  const { data: allTasks = [], isLoading: tasksLoading } = useQuery<InboxTask[]>({
    queryKey: ["/api/inbox/tasks"],
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
  });

  // Hidden tasks (dismissed + snoozed)
  const { data: hiddenTasks = [] } = useQuery<InboxTask[]>({
    queryKey: ["/api/inbox/tasks/hidden"],
    enabled: status?.connected ?? false,
    refetchInterval: 60_000,
  });

  // Clients for sender matching
  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  // Refresh (live Gmail fetch)
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/inbox/messages");
      return res.json() as Promise<InboxTask[]>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/inbox/tasks"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/last-sync"] });
      toast({ title: `Refreshed — ${data.length} email${data.length !== 1 ? "s" : ""}` });
    },
    onError: () => toast({ title: "Refresh failed", variant: "destructive" }),
  });

  // Disconnect the current account before either leaving Gmail disconnected or
  // starting a new OAuth flow for a different account.
  const disconnectMutation = useMutation({
    mutationFn: async (action: AccountAction) => {
      await apiRequest("DELETE", "/api/gmail/disconnect");
      return action;
    },
    onSuccess: (action) => {
      queryClient.setQueryData(["/api/inbox/status"], { connected: false, email: null });
      queryClient.setQueryData(["/api/inbox/tasks"], []);
      queryClient.setQueryData(["/api/inbox/tasks/hidden"], []);
      queryClient.setQueryData(["/api/inbox/last-sync"], { lastSyncedAt: null });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      setAccountAction(null);

      if (action === "switch") {
        window.location.href = "/api/gmail/auth?returnTo=/gmail-todos";
        return;
      }

      toast({
        title: "Gmail disconnected",
        description: "Your Gmail access was removed and cached Gmail Todos were cleared.",
      });
    },
    onError: (error: Error) => {
      setAccountAction(null);
      toast({
        title: "Could not disconnect Gmail",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Auto-fetch when connected but empty
  useEffect(() => {
    if (status?.connected && !tasksLoading && allTasks.length === 0 && !refreshMutation.isPending) {
      refreshMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected, tasksLoading]);

  const handleConnect = () => {
    setConnecting(true);
    window.location.href = "/api/gmail/auth?returnTo=/gmail-todos";
  };

  // Toggle done — optimistic update
  const handleToggle = (emailId: string, isDone: boolean) => {
    queryClient.setQueryData(["/api/inbox/tasks"], (old: InboxTask[] = []) =>
      old.map(t => t.emailId === emailId ? { ...t, isDone } : t)
    );
    apiRequest("PATCH", `/api/inbox/tasks/${emailId}/done`, { isDone }).catch(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks"] });
      toast({ title: "Couldn't update task", variant: "destructive" });
    });
  };

  // Derive today's active tasks
  const todayTasks = useMemo(() =>
    allTasks.filter(t => !t.dismissed && !t.snoozedUntil && isToday(new Date(t.receivedAt))),
    [allTasks]
  );

  // Dismissed group from hidden tasks
  const dismissedGroup = useMemo(() =>
    hiddenTasks.filter(t => t.dismissed),
    [hiddenTasks]
  );

  // ── Keep selectedDismissedIds in sync when dismissed emails leave the group ──
  // After a restore or delete, that email ID is removed from dismissedGroup.
  // This effect cleans any stale IDs so "Select all" always reflects reality.
  useEffect(() => {
    const currentIds = new Set(dismissedGroup.map(t => t.emailId));
    setSelectedDismissedIds(prev => {
      const next = new Set(Array.from(prev).filter(id => currentIds.has(id)));
      if (next.size === prev.size) return prev;
      return next;
    });
  }, [dismissedGroup]);

  // Select-all state derived from actual dismissedGroup
  const allDismissedSelected =
    dismissedGroup.length > 0 &&
    dismissedGroup.every(t => selectedDismissedIds.has(t.emailId));
  const someDismissedSelected =
    !allDismissedSelected &&
    dismissedGroup.some(t => selectedDismissedIds.has(t.emailId));

  function toggleSelectAllDismissed() {
    if (allDismissedSelected) {
      setSelectedDismissedIds(new Set());
    } else {
      setSelectedDismissedIds(new Set(dismissedGroup.map(t => t.emailId)));
    }
  }

  // Restore a single dismissed email
  function handleRestore(emailId: string) {
    // Immediately remove from selection so Select-all reflects the new state
    setSelectedDismissedIds(prev => {
      const next = new Set(prev);
      next.delete(emailId);
      return next;
    });
    // Optimistic: remove from hidden list and re-add to active tasks
    queryClient.setQueryData(["/api/inbox/tasks/hidden"], (old: InboxTask[] = []) =>
      old.filter(t => t.emailId !== emailId)
    );
    queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks"] });
    apiRequest("PATCH", `/api/inbox/tasks/${emailId}/restore`).catch(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      toast({ title: "Couldn't restore email", variant: "destructive" });
    });
  }

  // Delete a single dismissed email
  function handleDelete(emailId: string) {
    // Immediately remove from selection so Select-all reflects the new state
    setSelectedDismissedIds(prev => {
      const next = new Set(prev);
      next.delete(emailId);
      return next;
    });
    // Optimistic: remove from hidden list
    queryClient.setQueryData(["/api/inbox/tasks/hidden"], (old: InboxTask[] = []) =>
      old.filter(t => t.emailId !== emailId)
    );
    apiRequest("DELETE", `/api/inbox/tasks/${emailId}`).catch(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      toast({ title: "Couldn't delete email", variant: "destructive" });
    });
  }

  // Enrich tasks with client match + color
  const enrichedTasks = useMemo(() =>
    todayTasks.map(t => {
      const client = matchClient(t, clients);
      const colorKey = hashColor(t.senderEmail ?? t.sender);
      const chip = chipVars(colorKey);
      return { ...t, matchedClient: client, chip, priority: taskPriority(t) };
    }),
    [todayTasks, clients]
  );

  // Distinct client names for filter chips
  const clientNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const t of enrichedTasks) {
      const name = t.matchedClient?.name ?? t.sender;
      if (!seen.has(name)) { seen.add(name); names.push(name); }
    }
    return names;
  }, [enrichedTasks]);

  // Filtered tasks
  const filteredTasks = useMemo(() =>
    filter === "all"
      ? enrichedTasks
      : enrichedTasks.filter(t => (t.matchedClient?.name ?? t.sender) === filter),
    [enrichedTasks, filter]
  );

  const total = enrichedTasks.length;
  const doneCount = enrichedTasks.filter(t => t.isDone).length;
  const progressPct = total > 0 ? Math.round(doneCount / total * 100) : 0;

  const connected = status?.connected ?? false;
  const isLoading = statusLoading || tasksLoading;

  // Format sync time label
  const syncLabel = useMemo(() => {
    if (!syncInfo?.lastSyncedAt) return null;
    const d = new Date(syncInfo.lastSyncedAt);
    return format(d, "h:mm a");
  }, [syncInfo]);

  // Today's date label
  const todayLabel = format(new Date(), "EEEE, MMMM d");

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "28px 26px 50px" }}>
      <div style={{ maxWidth: "760px", margin: "0 auto" }}>

        {/* ── Title row ── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginBottom: "18px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "27px", fontWeight: 700, letterSpacing: "-.02em" }}>Today's tasks</h2>
            <p style={{ margin: "6px 0 0", fontSize: "13.5px", color: "var(--faint)" }}>
              {todayLabel} · {isLoading ? "Loading…" : `${doneCount} of ${total} done`}
            </p>
          </div>
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            style={{ display: "flex", alignItems: "center", gap: "7px", background: "var(--panel)", color: "var(--fg)", border: "1px solid var(--panel-bd)", borderRadius: "10px", padding: "9px 14px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flexShrink: 0, opacity: refreshMutation.isPending ? 0.6 : 1 }}
            data-testid="button-regenerate"
          >
            <RefreshCw size={15} className={refreshMutation.isPending ? "animate-spin" : ""} />
            {refreshMutation.isPending ? "Refreshing…" : "Regenerate"}
          </button>
        </div>

        {!connected && !isLoading ? (
          <NotConnected onConnect={handleConnect} connecting={connecting} />
        ) : isLoading ? (
          /* Loading skeletons */
          <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
            {[1,2,3,4].map(i => (
              <div key={i} style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "13px", padding: "14px 16px", display: "flex", gap: "13px", alignItems: "flex-start" }}>
                <div style={{ width: "22px", height: "22px", borderRadius: "50%", background: "var(--track)", flexShrink: 0, marginTop: "1px" }} />
                <div style={{ flex: 1 }}>
                  <div style={{ height: "14px", background: "var(--track)", borderRadius: "4px", width: "60%", marginBottom: "10px" }} />
                  <div style={{ height: "11px", background: "var(--track)", borderRadius: "4px", width: "40%" }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* ── Connected account controls ── */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "14px",
                flexWrap: "wrap",
                background: "var(--panel)",
                border: "1px solid var(--panel-bd)",
                borderRadius: "12px",
                padding: "11px 13px",
                marginBottom: "14px",
              }}
              data-testid="gmail-account-controls"
            >
              <div style={{ display: "flex", alignItems: "center", gap: "9px", minWidth: 0 }}>
                <Mail size={16} style={{ color: "var(--jox-primary)", flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "11px", color: "var(--faint)", lineHeight: 1.2 }}>Connected Gmail</div>
                  <div
                    style={{ fontSize: "13px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={status?.email ?? "Connected Google account"}
                    data-testid="text-connected-gmail"
                  >
                    {status?.email ?? "Connected Google account"}
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap" }}>
                <button
                  onClick={() => setAccountAction("switch")}
                  disabled={disconnectMutation.isPending}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "transparent", color: "var(--jox-primary)", border: "1px solid var(--panel-bd)", borderRadius: "8px", padding: "7px 10px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: disconnectMutation.isPending ? 0.6 : 1 }}
                  data-testid="button-switch-gmail"
                >
                  <ArrowLeftRight size={14} />
                  Switch account
                </button>
                <button
                  onClick={() => setAccountAction("disconnect")}
                  disabled={disconnectMutation.isPending}
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "transparent", color: "var(--faint)", border: "1px solid var(--panel-bd)", borderRadius: "8px", padding: "7px 10px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: disconnectMutation.isPending ? 0.6 : 1 }}
                  data-testid="button-disconnect-gmail"
                >
                  <Unplug size={14} />
                  Disconnect
                </button>
              </div>
            </div>

            {/* ── Gemini-style banner ── */}
            <div style={{ display: "flex", alignItems: "center", gap: "13px", background: "var(--gem-bg)", border: "1px solid var(--gem-bd)", borderRadius: "14px", padding: "14px 16px", marginBottom: "18px" }}>
              <div style={{ flexShrink: 0, animation: "sparklePulse 3s ease-in-out infinite" }}>
                <Sparkle />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13.5px", fontWeight: 700, color: "var(--fg)" }}>Summarized from your inbox</div>
                <div style={{ fontSize: "12px", color: "var(--faint)", marginTop: "1px" }}>
                  {total} email{total !== 1 ? "s" : ""} from or mentioning your clients
                  {syncLabel ? ` · updated ${syncLabel}` : ""}
                </div>
              </div>
              <span style={{ flexShrink: 0, fontSize: "10.5px", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--b-purple-fg)", background: "var(--b-purple-bg)", padding: "4px 9px", borderRadius: "7px" }}>
                Smart Inbox
              </span>
            </div>

            {/* ── Progress bar ── */}
            <div style={{ height: "6px", borderRadius: "4px", background: "var(--track)", overflow: "hidden", marginBottom: "20px" }}>
              <div style={{ width: `${progressPct}%`, height: "100%", background: "var(--jox-primary)", transition: "width .25s" }} />
            </div>

            {/* ── Client filter chips ── */}
            {clientNames.length > 0 && (
              <div style={{ display: "flex", gap: "7px", marginBottom: "18px", flexWrap: "wrap" }}>
                {[{ key: "all", label: "All clients" }, ...clientNames.map(n => ({ key: n, label: n }))].map(f => {
                  const active = filter === f.key;
                  return (
                    <button
                      key={f.key}
                      onClick={() => setFilter(f.key)}
                      style={{ cursor: "pointer", fontFamily: "inherit", fontSize: "12.5px", fontWeight: 600, padding: "6px 12px", borderRadius: "8px", border: "1px solid " + (active ? "transparent" : "var(--panel-bd)"), background: active ? "var(--jox-primary)" : "var(--panel)", color: active ? "#fff" : "var(--faint)", whiteSpace: "nowrap" }}
                      data-testid={`filter-${f.key}`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* ── Task list ── */}
            <div style={{ display: "flex", flexDirection: "column", gap: "9px" }}>
              {filteredTasks.length === 0 && (
                <div style={{ padding: "48px 0", textAlign: "center", fontSize: "13px", color: "var(--faint)" }}>
                  {total === 0 ? "No client emails today yet." : "No tasks for this client."}
                </div>
              )}
              {filteredTasks.map(task => {
                const prio = PRIO[task.priority];
                const chip = task.chip;
                const clientLabel = task.matchedClient?.name ?? task.sender;
                const openHref = task.matchedClient
                  ? `/clients/${task.matchedClient.id}`
                  : "/invoices";
                const receivedAt = new Date(task.receivedAt);
                const timeStr = format(receivedAt, "h:mm a");

                return (
                  <div
                    key={task.id}
                    className="taskrow"
                    style={{ display: "flex", alignItems: "flex-start", gap: "13px", background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "13px", padding: "14px 16px", transition: "background .12s" }}
                    data-testid={`task-row-${task.emailId}`}
                  >
                    <RoundCheck
                      checked={task.isDone}
                      onToggle={() => handleToggle(task.emailId, !task.isDone)}
                    />

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
                        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: prio, flexShrink: 0 }} />
                        <span
                          style={{ fontSize: "14px", fontWeight: 600, lineHeight: 1.4, color: task.isDone ? "var(--faint)" : "var(--fg)", textDecoration: task.isDone ? "line-through" : "none" }}
                          data-testid={`task-subject-${task.emailId}`}
                        >
                          {task.subject}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "9px", marginTop: "7px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 9px", borderRadius: "7px", background: chip.bg, color: chip.fg, flexShrink: 0 }}>
                          {clientLabel}
                        </span>
                        <span style={{ fontSize: "12px", color: "var(--faint)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          from {task.sender}
                        </span>
                      </div>
                    </div>

                    {/* Right: time + open link */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px", flexShrink: 0 }}>
                      <span className="font-mono" style={{ fontSize: "11px", color: "var(--faint)" }}>{timeStr}</span>
                      <Link href={openHref}>
                        <a style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11.5px", fontWeight: 600, color: "var(--jox-primary)", textDecoration: "none" }}
                          data-testid={`link-open-${task.emailId}`}>
                          Open
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" />
                          </svg>
                        </a>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Footer ── */}
            {total > 0 && (
              <div style={{ textAlign: "center", marginTop: "22px", fontSize: "12.5px", color: "var(--faint)" }}>
                That's everything from your client emails today.
              </div>
            )}

            {/* ── Hidden panel (Dismissed emails) ── */}
            {dismissedGroup.length > 0 && (
              <div style={{ marginTop: "28px" }}>
                {/* Panel toggle header */}
                <button
                  onClick={() => setHiddenPanelOpen(o => !o)}
                  style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", background: "none", border: "none", cursor: "pointer", padding: "0", fontFamily: "inherit", marginBottom: hiddenPanelOpen ? "10px" : "0" }}
                  data-testid="button-toggle-hidden-panel"
                >
                  <span style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--faint)" }}>
                    Dismissed
                  </span>
                  <span style={{ fontSize: "11px", fontWeight: 700, padding: "1px 7px", borderRadius: "5px", background: "var(--track)", color: "var(--faint)" }}
                    data-testid="badge-dismissed-count">
                    {dismissedGroup.length}
                  </span>
                  <span style={{ marginLeft: "auto", color: "var(--faint)" }}>
                    {hiddenPanelOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </span>
                </button>

                {hiddenPanelOpen && (
                  <div style={{ background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "13px", overflow: "hidden" }}>
                    {/* Select-all row */}
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderBottom: "1px solid var(--panel-bd)" }}>
                      {/* Native checkbox used for indeterminate support */}
                      <input
                        type="checkbox"
                        checked={allDismissedSelected}
                        ref={el => { if (el) el.indeterminate = someDismissedSelected; }}
                        onChange={toggleSelectAllDismissed}
                        style={{ width: "15px", height: "15px", cursor: "pointer", accentColor: "var(--jox-primary)" }}
                        data-testid="checkbox-select-all-dismissed"
                      />
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--faint)" }}>
                        {allDismissedSelected
                          ? `All ${dismissedGroup.length} selected`
                          : someDismissedSelected
                          ? `${selectedDismissedIds.size} selected`
                          : "Select all"}
                      </span>
                    </div>

                    {/* Dismissed email rows */}
                    {dismissedGroup.map((task, i) => {
                      const isLast = i === dismissedGroup.length - 1;
                      const colorKey = hashColor(task.senderEmail ?? task.sender);
                      const chip = chipVars(colorKey);
                      const isSelected = selectedDismissedIds.has(task.emailId);
                      const ageStr = dismissedAgeLabel(task.receivedAt);

                      return (
                        <div
                          key={task.emailId}
                          style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderBottom: isLast ? "none" : "1px solid var(--panel-bd)", background: isSelected ? "var(--track)" : "transparent", transition: "background .1s" }}
                          data-testid={`dismissed-row-${task.emailId}`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              setSelectedDismissedIds(prev => {
                                const next = new Set(prev);
                                if (next.has(task.emailId)) next.delete(task.emailId);
                                else next.add(task.emailId);
                                return next;
                              });
                            }}
                            style={{ width: "15px", height: "15px", cursor: "pointer", accentColor: "var(--jox-primary)", flexShrink: 0 }}
                            data-testid={`checkbox-dismissed-${task.emailId}`}
                          />

                          {/* Subject + sender */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "line-through" }}>
                              {task.subject}
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "7px", marginTop: "3px" }}>
                              <span style={{ fontSize: "10.5px", fontWeight: 700, padding: "1px 7px", borderRadius: "6px", background: chip.bg, color: chip.fg, flexShrink: 0 }}>
                                {task.sender}
                              </span>
                              <span style={{ fontSize: "11px", color: "var(--faint)" }}
                                data-testid={`dismissed-age-${task.emailId}`}>
                                {ageStr}
                              </span>
                            </div>
                          </div>

                          {/* Restore button */}
                          <button
                            onClick={() => handleRestore(task.emailId)}
                            title="Restore to inbox"
                            style={{ flexShrink: 0, background: "var(--track)", color: "var(--fg)", border: "1px solid var(--panel-bd)", borderRadius: "7px", padding: "4px 10px", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
                            data-testid={`button-restore-${task.emailId}`}
                          >
                            Restore
                          </button>

                          {/* Delete button */}
                          <button
                            onClick={() => handleDelete(task.emailId)}
                            title="Delete permanently"
                            style={{ flexShrink: 0, border: "none", background: "none", cursor: "pointer", color: "var(--faint)", padding: "4px", display: "flex", alignItems: "center", borderRadius: "6px", lineHeight: 1 }}
                            data-testid={`button-delete-${task.emailId}`}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <AlertDialog
        open={accountAction !== null}
        onOpenChange={(open) => {
          if (!open && !disconnectMutation.isPending) setAccountAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {accountAction === "switch" ? "Switch Gmail account?" : "Disconnect Gmail?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {accountAction === "switch" ? (
                <>
                  This will disconnect <strong>{status?.email ?? "your current Gmail account"}</strong>, clear cached Gmail Todos, and open Google’s account chooser. Your Gmail messages will remain in Gmail.
                </>
              ) : (
                <>
                  This will remove access for <strong>{status?.email ?? "your Gmail account"}</strong> and clear cached Gmail Todos from JobsOxo. Your Gmail messages will remain in Gmail.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnectMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={accountAction === "disconnect" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
              disabled={disconnectMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (accountAction) disconnectMutation.mutate(accountAction);
              }}
              data-testid="button-confirm-gmail-account-action"
            >
              {disconnectMutation.isPending
                ? accountAction === "switch" ? "Switching…" : "Disconnecting…"
                : accountAction === "switch" ? "Switch account" : "Disconnect Gmail"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
