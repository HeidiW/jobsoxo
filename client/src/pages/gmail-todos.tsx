import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";
import { format, differenceInDays } from "date-fns";
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
import { ArrowLeftRight, ChevronDown, ChevronUp, ExternalLink, Mail, PlugZap, RefreshCw, Unplug } from "lucide-react";
import { partitionEmailTasks, tomorrowSnoozeUntil, type EmailStatus } from "@/components/inbox/email-state";

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
  high:   "var(--jx-orange)",
  medium: "var(--jx-gold)",
  low:    "var(--jx-ink-3)",
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
function RoundCheck({ emailId, checked, onToggle, disabled }: { emailId: string; checked: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      disabled={disabled}
      className="cbtn jx-mail-check"
      aria-label={checked ? "Mark email to do" : "Mark email done"}
      aria-pressed={checked}
      style={{
        flexShrink: 0, width: "22px", height: "22px", marginTop: "1px",
        borderRadius: "50%", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "transform .15s, opacity .15s",
        border: checked ? "none" : "2px solid var(--panel-bd)",
        background: checked ? "var(--jox-primary)" : "transparent",
      }}
      data-testid={`checkbox-toggle-${emailId}`}
    >
      {checked && (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
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
        Connect your personal Gmail to bring client emails that need a reply or action into your inbox.
      </p>
      <button
        onClick={onConnect}
        disabled={connecting}
        className="jx-connect-button"
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
export default function GmailTodos({ embedded = false }: { embedded?: boolean }) {
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>("all");
  const [statusTab, setStatusTab] = useState<EmailStatus>("todo");
  const [connecting, setConnecting] = useState(false);
  const [accountAction, setAccountAction] = useState<AccountAction | null>(null);
  const [hiddenPanelOpen, setHiddenPanelOpen] = useState(false);
  const [selectedDismissedIds, setSelectedDismissedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [pendingEmailActions, setPendingEmailActions] = useState<Set<string>>(new Set());

  // OAuth redirect handling
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailConnected = params.get("gmail_connected");
    const gmailError = params.get("gmail_error");
    if (gmailConnected === "1") {
      trackEvent("gmail_connected", { location: "gmail_todos" });
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
  const { data: status, isLoading: statusLoading, isError: statusError, refetch: refetchStatus } = useQuery<{ connected: boolean; email: string | null }>({
    queryKey: ["/api/inbox/status"],
    refetchInterval: 30_000,
  });

  // Last-sync timestamp
  const { data: syncInfo } = useQuery<{ lastSyncedAt: string | null }>({
    queryKey: ["/api/inbox/last-sync"],
    enabled: status?.connected ?? false,
    refetchInterval: 60_000,
  });

  // Cached active tasks include older emails and expired snoozes.
  const { data: allTasks = [], isLoading: tasksLoading, isError: tasksError, refetch: refetchTasks } = useQuery<InboxTask[]>({
    queryKey: ["/api/inbox/tasks"],
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
  });

  // Hidden tasks (dismissed + snoozed)
  const { data: hiddenTasks = [], isLoading: hiddenLoading, isError: hiddenError, refetch: refetchHidden } = useQuery<InboxTask[]>({
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

  const toggleDoneMutation = useMutation({
    mutationFn: async ({ emailId, isDone }: { emailId: string; isDone: boolean }) => {
      const response = await apiRequest("PATCH", `/api/inbox/tasks/${emailId}/done`, { isDone });
      return response.json() as Promise<InboxTask>;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["/api/inbox/tasks"], (old: InboxTask[] = []) =>
        old.map(task => task.emailId === updated.emailId ? updated : task)
      );
      queryClient.setQueryData(["/api/inbox/tasks/hidden"], (old: InboxTask[] = []) =>
        old.map(task => task.emailId === updated.emailId ? updated : task)
      );
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      toast({ title: "Couldn't update email", description: "Your change was not saved. Try again.", variant: "destructive" });
    },
  });

  const snoozeMutation = useMutation({
    mutationFn: async (emailId: string) => {
      const response = await apiRequest("PATCH", `/api/inbox/tasks/${emailId}/snooze`, { until: tomorrowSnoozeUntil() });
      return response.json() as Promise<InboxTask>;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["/api/inbox/tasks"], (old: InboxTask[] = []) =>
        old.filter(task => task.emailId !== updated.emailId)
      );
      queryClient.setQueryData(["/api/inbox/tasks/hidden"], (old: InboxTask[] = []) => [
        updated,
        ...old.filter(task => task.emailId !== updated.emailId),
      ]);
      toast({ title: "Email snoozed", description: "It will return to your to-do list tomorrow." });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      toast({ title: "Couldn't snooze email", description: "The email is still in your to-do list.", variant: "destructive" });
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (emailIds: string[]) => {
      await apiRequest("DELETE", "/api/inbox/tasks/bulk", { emailIds });
      return emailIds;
    },
    onSuccess: (emailIds) => {
      const deleted = new Set(emailIds);
      queryClient.setQueryData(["/api/inbox/tasks/hidden"], (old: InboxTask[] = []) =>
        old.filter(task => !deleted.has(task.emailId))
      );
      queryClient.setQueryData(["/api/inbox/tasks"], (old: InboxTask[] = []) =>
        old.filter(task => !deleted.has(task.emailId))
      );
      setSelectedDismissedIds(new Set());
      setConfirmBulkDelete(false);
      toast({ title: `${emailIds.length} email${emailIds.length === 1 ? "" : "s"} deleted` });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      toast({ title: "Couldn't delete selected emails", description: "No deletion was confirmed. Refresh and try again.", variant: "destructive" });
    },
  });

  // Disconnect the current account before either leaving Gmail disconnected or
  // starting a new OAuth flow for a different account.
  const disconnectMutation = useMutation({
    mutationFn: async (action: AccountAction) => {
      await apiRequest("DELETE", "/api/gmail/disconnect");
      return action;
    },
    onSuccess: (action) => {
      trackEvent("gmail_disconnected", {
        action,
        location: "gmail_todos",
      });
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

  // Persist completion against the user's Gmail task.
  const handleToggle = (emailId: string, isDone: boolean) => {
    if (toggleDoneMutation.isPending || snoozeMutation.isPending) return;
    toggleDoneMutation.mutate({ emailId, isDone });
  };

  // Keep older actionable mail, expired snoozes, and future snoozes reachable.
  const emailGroups = useMemo(
    () => partitionEmailTasks(allTasks, hiddenTasks),
    [allTasks, hiddenTasks],
  );
  const statusTasks = emailGroups[statusTab];

  // Dismissed mail stays in its own restoration area, never in Done.
  const dismissedGroup = emailGroups.dismissed;

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

  function deleteSelectedDismissed() {
    const ids = dismissedGroup
      .filter(task => selectedDismissedIds.has(task.emailId))
      .map(task => task.emailId);
    if (ids.length > 0 && !bulkDeleteMutation.isPending) bulkDeleteMutation.mutate(ids);
  }

  // Restore a single dismissed email
  async function handleRestore(emailId: string) {
    if (pendingEmailActions.has(emailId)) return;
    setPendingEmailActions(previous => new Set(previous).add(emailId));
    // Immediately remove from selection so Select-all reflects the new state
    setSelectedDismissedIds(prev => {
      const next = new Set(prev);
      next.delete(emailId);
      return next;
    });
    // Capture the task before removing it so we can add it to the active list
    const hiddenCache = queryClient.getQueryData<InboxTask[]>(["/api/inbox/tasks/hidden"]) ?? [];
    const taskToRestore = hiddenCache.find(t => t.emailId === emailId);

    // Optimistic: remove from hidden list
    queryClient.setQueryData(["/api/inbox/tasks/hidden"], (old: InboxTask[] = []) =>
      old.filter(t => t.emailId !== emailId)
    );
    // Optimistic: add directly to the active task cache (avoids a refetch race
    // where the GET completes before the PATCH has updated dismissed=false in the DB)
    if (taskToRestore) {
      queryClient.setQueryData(["/api/inbox/tasks"], (old: InboxTask[] = []) => [
        { ...taskToRestore, dismissed: false, snoozedUntil: null },
        ...old.filter(task => task.emailId !== emailId),
      ]);
    }

    try {
      await apiRequest("PATCH", `/api/inbox/tasks/${emailId}/restore`);
    } catch {
      // On failure, revert both caches to server truth
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks"] });
      toast({ title: "Couldn't restore email", variant: "destructive" });
    } finally {
      setPendingEmailActions(previous => {
        const next = new Set(previous);
        next.delete(emailId);
        return next;
      });
    }
  }

  // Delete a single dismissed email
  async function handleDelete(emailId: string) {
    if (pendingEmailActions.has(emailId)) return;
    setPendingEmailActions(previous => new Set(previous).add(emailId));
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
    queryClient.setQueryData(["/api/inbox/tasks"], (old: InboxTask[] = []) =>
      old.filter(t => t.emailId !== emailId)
    );
    try {
      await apiRequest("DELETE", `/api/inbox/tasks/${emailId}`);
    } catch {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks"] });
      toast({ title: "Couldn't delete email", variant: "destructive" });
    } finally {
      setPendingEmailActions(previous => {
        const next = new Set(previous);
        next.delete(emailId);
        return next;
      });
    }
  }

  // Enrich tasks with client match + color
  const enrichedTasks = useMemo(() =>
    statusTasks.map(t => {
      const client = matchClient(t, clients);
      const colorKey = hashColor(t.senderEmail ?? t.sender);
      const chip = chipVars(colorKey);
      return { ...t, matchedClient: client, chip, priority: taskPriority(t) };
    }),
    [statusTasks, clients]
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

  const total = emailGroups.todo.length + emailGroups.snoozed.length + emailGroups.done.length;
  const doneCount = emailGroups.done.length;
  const progressPct = total > 0 ? Math.round(doneCount / total * 100) : 0;

  const connected = status?.connected ?? false;
  const isLoading = statusLoading || tasksLoading || (connected && hiddenLoading);

  // Format sync time label
  const syncLabel = useMemo(() => {
    if (!syncInfo?.lastSyncedAt) return null;
    const d = new Date(syncInfo.lastSyncedAt);
    return format(d, "h:mm a");
  }, [syncInfo]);

  // Today's date label
  return (
    <div className="jx-gmail-workspace" style={{ flex: 1, overflowY: "auto", padding: "28px 26px 50px" }}>
      <div style={{ maxWidth: "760px", margin: "0 auto" }}>

        {/* ── Title row ── */}
        <div className="jx-gmail-heading" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginBottom: "18px" }}>
          <div>
            {!embedded && <h2 style={{ margin: 0, fontSize: "27px", fontWeight: 700, letterSpacing: "-.02em" }}>Gmail tasks</h2>}
            <p style={{ margin: "6px 0 0", fontSize: "13.5px", color: "var(--faint)" }}>
              {status?.email ? `${status.email} · ` : ""}{isLoading ? "Loading email tasks…" : `${doneCount} of ${total} complete`}
              {syncLabel ? ` · synced ${syncLabel}` : ""}
            </p>
          </div>
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending || !connected}
            style={{ display: "flex", alignItems: "center", gap: "7px", background: "var(--panel)", color: "var(--fg)", border: "1px solid var(--panel-bd)", borderRadius: "10px", padding: "9px 14px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", flexShrink: 0, opacity: refreshMutation.isPending ? 0.6 : 1 }}
            className="jx-sync-button"
            data-testid="button-regenerate"
          >
            <RefreshCw size={15} className={refreshMutation.isPending ? "animate-spin" : ""} />
            {refreshMutation.isPending ? "Syncing…" : "Sync now"}
          </button>
        </div>

        {statusError && !statusLoading ? (
          <div className="jx-mail-error" role="alert">
            <span>Gmail connection status couldn’t be loaded.</span>
            <button className="jx-mail-action" onClick={() => void refetchStatus()}>Try again</button>
          </div>
        ) : !connected && !isLoading ? (
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
            {(tasksError || refreshMutation.isError) && (
              <div className="jx-mail-error mb-4" role="alert">
                <span>Email tasks couldn’t be refreshed. Your saved task states are unchanged.</span>
                <button
                  className="jx-mail-action"
                  disabled={refreshMutation.isPending}
                  onClick={() => {
                    void refetchTasks();
                    refreshMutation.reset();
                    refreshMutation.mutate();
                  }}
                  data-testid="button-retry-gmail"
                >
                  Try again
                </button>
              </div>
            )}
            {hiddenError && (
              <div className="jx-mail-error mb-4" role="alert">
                <span>Hidden emails couldn’t be loaded. Your dismissed and snoozed messages have not been changed.</span>
                <button className="jx-mail-action" onClick={() => void refetchHidden()} data-testid="button-retry-hidden">
                  Try again
                </button>
              </div>
            )}
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
                  className="jx-account-button"
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "transparent", color: "var(--jox-primary)", border: "1px solid var(--panel-bd)", borderRadius: "8px", padding: "7px 10px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: disconnectMutation.isPending ? 0.6 : 1 }}
                  data-testid="button-switch-gmail"
                >
                  <ArrowLeftRight size={14} />
                  Switch account
                </button>
                <button
                  onClick={() => setAccountAction("disconnect")}
                  disabled={disconnectMutation.isPending}
                  className="jx-account-button"
                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "transparent", color: "var(--faint)", border: "1px solid var(--panel-bd)", borderRadius: "8px", padding: "7px 10px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", opacity: disconnectMutation.isPending ? 0.6 : 1 }}
                  data-testid="button-disconnect-gmail"
                >
                  <Unplug size={14} />
                  Disconnect
                </button>
              </div>
            </div>

            <div className="jx-mail-status-tabs" role="group" aria-label="Email task status">
              {([
                ["todo", "To do", emailGroups.todo.length],
                ["snoozed", "Snoozed", emailGroups.snoozed.length],
                ["done", "Done", emailGroups.done.length],
              ] as const).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  className="jx-mail-status-tab"
                  aria-pressed={statusTab === key}
                  onClick={() => { setStatusTab(key); setFilter("all"); }}
                  data-testid={`filter-status-${key}`}
                >
                  {label}<span className="jx-mail-count">{count}</span>
                </button>
              ))}
            </div>

            {/* ── Progress bar ── */}
            <div aria-label={`${progressPct}% complete`} style={{ height: "6px", borderRadius: "4px", background: "var(--track)", overflow: "hidden", marginBottom: "20px" }}>
              <div style={{ width: `${progressPct}%`, height: "100%", background: "var(--jox-primary)" }} />
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
                <div className="jx-mail-empty" style={{ padding: "48px 0", textAlign: "center", fontSize: "13px", color: "var(--faint)" }}>
                  <div className="mb-2 font-display text-2xl font-bold">Nothing here</div>
                  {statusTab === "todo"
                    ? "You're all caught up."
                    : statusTab === "snoozed"
                    ? "No emails are snoozed right now."
                    : "No completed emails yet."}
                  {filter !== "all" ? " Try another client filter." : ""}
                </div>
              )}
              {filteredTasks.map(task => {
                const prio = PRIO[task.priority];
                const chip = task.chip;
                const clientLabel = task.matchedClient?.name ?? task.sender;
                const receivedAt = new Date(task.receivedAt);
                const timeStr = format(receivedAt, "h:mm a");
                const isSavingThis = (toggleDoneMutation.isPending && toggleDoneMutation.variables?.emailId === task.emailId)
                  || (snoozeMutation.isPending && snoozeMutation.variables === task.emailId);

                return (
                  <div
                    key={task.id}
                    className="taskrow jx-mail-row"
                    style={{ display: "flex", alignItems: "flex-start", gap: "13px", background: "var(--panel)", border: "1px solid var(--panel-bd)", borderRadius: "13px", padding: "14px 16px", transition: "background .12s" }}
                    data-testid={`task-row-${task.emailId}`}
                  >
                    <RoundCheck
                      emailId={task.emailId}
                      checked={task.isDone}
                      disabled={toggleDoneMutation.isPending || snoozeMutation.isPending}
                      onToggle={() => handleToggle(task.emailId, !task.isDone)}
                    />

                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-card text-sm font-bold text-jx-ink" aria-hidden="true">
                      {(task.sender.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join("") || "EM").toUpperCase()}
                    </div>

                    <div className="jx-mail-content">
                      <div className="flex min-w-0 items-center gap-2">
                        <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: prio, flexShrink: 0 }} />
                        <span className="jx-mail-subject" data-testid={`task-sender-${task.emailId}`}>
                          {task.sender}{task.matchedClient ? ` · ${task.matchedClient.name}` : ""}
                        </span>
                        <span className="hidden shrink-0 text-xs text-jx-ink-3 sm:inline">{timeStr}</span>
                      </div>
                      <a href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(task.emailId)}`} target="_blank" rel="noreferrer" className="jx-mail-subject mt-0.5">
                        <span data-testid={`task-subject-${task.emailId}`}>{task.subject}</span>
                      </a>
                      <div className="jx-mail-snippet" title={task.snippet ?? undefined}>
                        {task.snippet || `Email from ${task.sender}`}
                      </div>
                      <div className="jx-mail-meta flex items-center gap-2">
                        <span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 9px", borderRadius: "7px", background: chip.bg, color: chip.fg, flexShrink: 0 }}>
                          {clientLabel}
                        </span>
                        <span style={{ fontSize: "12px", color: "var(--faint)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          from {task.sender}
                        </span>
                      </div>
                    </div>

                    <div className="jx-mail-actions">
                      <span className="font-mono text-[11px] text-jx-ink-2 sm:hidden">{timeStr}</span>
                      {statusTab === "todo" && (
                        <button
                          className="jx-mail-action"
                          disabled={isSavingThis || snoozeMutation.isPending || toggleDoneMutation.isPending}
                          onClick={() => snoozeMutation.mutate(task.emailId)}
                          data-testid={`button-snooze-${task.emailId}`}
                        >
                          {isSavingThis && snoozeMutation.variables === task.emailId ? "Snoozing…" : "Snooze"}
                        </button>
                      )}
                      {statusTab === "snoozed" && (
                        <button
                          className="jx-mail-action"
                          disabled={isSavingThis || pendingEmailActions.has(task.emailId)}
                          onClick={() => handleRestore(task.emailId)}
                          data-testid={`button-unsnooze-${task.emailId}`}
                        >Restore</button>
                      )}
                      <a
                        className="jx-mail-action inline-flex items-center gap-1.5 no-underline"
                        href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(task.emailId)}`}
                        target="_blank"
                        rel="noreferrer"
                        data-testid={`link-open-${task.emailId}`}
                      >
                        Email <ExternalLink size={13} />
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Footer ── */}
            {total > 0 && (
              <div style={{ textAlign: "center", marginTop: "22px", fontSize: "12.5px", color: "var(--faint)" }}>
                {statusTab === "todo" ? "Older mail stays here until you complete or snooze it." : "Your email task history stays available here."}
              </div>
            )}

            {/* ── Hidden panel (Dismissed emails) ── */}
            {dismissedGroup.length > 0 && (
              <div style={{ marginTop: "28px" }}>
                {/* Panel toggle header */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => setHiddenPanelOpen(o => !o)}
                    style={{ display: "flex", alignItems: "center", gap: "8px", flex: "1 1 180px", background: "none", border: "none", cursor: "pointer", padding: "0", fontFamily: "inherit", marginBottom: hiddenPanelOpen ? "10px" : "0" }}
                    data-testid="button-toggle-hidden-panel"
                  >
                    <span style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--faint)" }}>Dismissed</span>
                    <span style={{ fontSize: "11px", fontWeight: 700, padding: "1px 7px", borderRadius: "5px", background: "var(--track)", color: "var(--faint)" }}
                      data-testid="badge-dismissed-count">{dismissedGroup.length}</span>
                    <span style={{ marginLeft: "auto", color: "var(--faint)" }}>
                      {hiddenPanelOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </span>
                  </button>
                  {selectedDismissedIds.size > 0 && (
                    <button
                      className="jx-mail-action"
                      disabled={bulkDeleteMutation.isPending}
                      onClick={() => setConfirmBulkDelete(true)}
                      data-testid="button-delete-selected"
                    >
                      Delete selected ({selectedDismissedIds.size})
                    </button>
                  )}
                  {hiddenError && (
                    <button className="jx-mail-action" onClick={() => void refetchHidden()} data-testid="button-retry-hidden">
                      Retry hidden emails
                    </button>
                  )}
                </div>

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

                    {hiddenError && <div className="jx-mail-error m-3">Hidden emails couldn’t be loaded. Try again above.</div>}
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
                            disabled={pendingEmailActions.has(task.emailId)}
                            title="Restore to inbox"
                            style={{ flexShrink: 0, background: "var(--track)", color: "var(--fg)", border: "1px solid var(--panel-bd)", borderRadius: "7px", padding: "4px 10px", fontSize: "11.5px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
                            data-testid={`button-restore-${task.emailId}`}
                          >
                            Restore
                          </button>

                          {/* Delete button */}
                          <button
                            onClick={() => handleDelete(task.emailId)}
                            disabled={pendingEmailActions.has(task.emailId)}
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

      <AlertDialog open={confirmBulkDelete} onOpenChange={(open) => {
        if (!bulkDeleteMutation.isPending) setConfirmBulkDelete(open);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedDismissedIds.size} selected email{selectedDismissedIds.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected messages from JobsOxo. The original emails remain in Gmail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkDeleteMutation.isPending || selectedDismissedIds.size === 0}
              onClick={(event) => {
                event.preventDefault();
                deleteSelectedDismissed();
              }}
              data-testid="button-confirm-delete-selected"
            >
              {bulkDeleteMutation.isPending ? "Deleting…" : "Delete emails"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
