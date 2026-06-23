import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Mail,
  RefreshCw,
  CheckCheck,
  Inbox,
  Wifi,
  WifiOff,
  Clock,
  Calendar,
  CircleDot,
  PlugZap,
  Unplug,
  MoreHorizontal,
  X,
  BellOff,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Trash2,
  Tag,
  Check,
} from "lucide-react";
import { format, isToday, isYesterday, formatDistanceToNow } from "date-fns";
import type { InboxTask } from "@shared/schema";

// ── Helpers ──────────────────────────────────────────────────────────────────

function midnightOn(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function snoozeOptionDates(): { label: string; date: Date }[] {
  const now = new Date();
  const tomorrow = midnightOn(new Date(now));
  tomorrow.setDate(tomorrow.getDate() + 1);

  const weekend = midnightOn(new Date(now));
  const dayOfWeek = weekend.getDay();
  const daysToSat = dayOfWeek === 6 ? 7 : (6 - dayOfWeek);
  weekend.setDate(weekend.getDate() + daysToSat);

  const nextWeek = midnightOn(new Date(now));
  const daysToMon = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7 || 7;
  nextWeek.setDate(nextWeek.getDate() + daysToMon);

  return [
    { label: "Tomorrow", date: tomorrow },
    { label: "This weekend", date: weekend },
    { label: "Next week", date: nextWeek },
  ];
}

function senderInitials(sender: string): string {
  const parts = sender.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return sender.slice(0, 2).toUpperCase();
}

function senderColor(email: string): string {
  const palette = [
    "bg-blue-500",
    "bg-emerald-500",
    "bg-violet-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-cyan-500",
    "bg-pink-500",
    "bg-indigo-500",
  ];
  let hash = 0;
  for (const ch of email) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  return palette[Math.abs(hash) % palette.length];
}

function groupByDay(tasks: InboxTask[]) {
  const today: InboxTask[] = [];
  const yesterday: InboxTask[] = [];
  const earlier: InboxTask[] = [];
  for (const t of tasks) {
    const d = new Date(t.receivedAt);
    if (isToday(d)) today.push(t);
    else if (isYesterday(d)) yesterday.push(t);
    else earlier.push(t);
  }
  return { today, yesterday, earlier };
}

// ── Not-connected card ────────────────────────────────────────────────────────

function NotConnectedCard({
  onConnect,
  connecting,
}: {
  onConnect: () => void;
  connecting: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center max-w-md mx-auto">
      <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-6">
        <Mail className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold mb-2">Connect your Gmail</h2>
      <p className="text-muted-foreground mb-2 leading-relaxed">
        Connect your Gmail account to see your inbox as a daily to-do list.
        Only inbox emails are read — nothing is sent or modified.
      </p>
      <Button
        className="mt-4"
        onClick={onConnect}
        disabled={connecting}
        data-testid="button-connect-gmail"
      >
        <PlugZap className="h-4 w-4 mr-2" />
        {connecting ? "Redirecting…" : "Connect Gmail"}
      </Button>
    </div>
  );
}

// ── Empty-inbox card (connected, but inbox is empty) ─────────────────────────

function EmptyInboxCard({
  onRefresh,
  loading,
}: {
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <CheckCheck className="h-12 w-12 text-green-500 mb-4" />
      <h3 className="font-semibold text-lg">All caught up!</h3>
      <p className="text-muted-foreground mt-1 mb-4">
        No emails in your inbox right now.
      </p>
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
        <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
        Refresh
      </Button>
    </div>
  );
}

// ── Task row ─────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  onToggle,
  onDismiss,
  onSnooze,
}: {
  task: InboxTask;
  onToggle: (emailId: string, isDone: boolean) => void;
  onDismiss: (emailId: string) => void;
  onSnooze: (emailId: string, until: Date) => void;
}) {
  const initials = senderInitials(task.sender);
  const color = senderColor(task.senderEmail ?? task.sender);
  const receivedAt = new Date(task.receivedAt);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [customDate, setCustomDate] = useState("");
  const quickOptions = snoozeOptionDates();

  const handleQuickSnooze = (date: Date) => {
    setSnoozeOpen(false);
    onSnooze(task.emailId, date);
  };

  const handleCustomSnooze = () => {
    if (!customDate) return;
    const date = new Date(customDate + "T00:00:00");
    if (isNaN(date.getTime())) return;
    setSnoozeOpen(false);
    setCustomDate("");
    onSnooze(task.emailId, date);
  };

  const minDate = format(new Date(Date.now() + 86_400_000), "yyyy-MM-dd");

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg transition-colors group ${
        task.isDone ? "opacity-50" : "hover:bg-muted/50 cursor-pointer"
      }`}
      onClick={() => onToggle(task.emailId, !task.isDone)}
      data-testid={`row-inbox-${task.emailId}`}
    >
      <div className="pt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={task.isDone}
          onCheckedChange={(checked) => onToggle(task.emailId, !!checked)}
          data-testid={`checkbox-inbox-${task.emailId}`}
          className="h-4 w-4"
        />
      </div>
      <div
        className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-semibold ${color}`}
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className={`text-sm font-medium truncate ${
              task.isDone
                ? "line-through text-muted-foreground"
                : !task.isRead
                ? "font-semibold"
                : ""
            }`}
          >
            {task.subject}
          </span>
          {!task.isRead && !task.isDone && (
            <CircleDot className="h-2.5 w-2.5 text-blue-500 shrink-0" />
          )}
          {task.snoozedUntil && !task.dismissed && (
            <span
              className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0 shrink-0"
              data-testid={`badge-snoozed-${task.emailId}`}
              title={`This email was snoozed until ${format(new Date(task.snoozedUntil), "PPP")}`}
            >
              <Clock className="h-3 w-3" />
              Snoozed until {format(new Date(task.snoozedUntil), "MMM d")} · {formatDistanceToNow(new Date(task.snoozedUntil), { addSuffix: true })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate max-w-[200px]">{task.sender}</span>
          {task.snippet && (
            <>
              <span>·</span>
              <span className="truncate max-w-[300px]">{task.snippet}</span>
            </>
          )}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-1 pt-0.5">
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {isToday(receivedAt)
            ? format(receivedAt, "h:mm a")
            : format(receivedAt, "MMM d")}
        </span>
        <div onClick={(e) => e.stopPropagation()}>
          <Popover open={snoozeOpen} onOpenChange={setSnoozeOpen}>
            <PopoverTrigger asChild>
              <span />
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="end">
              <p className="text-xs font-semibold text-muted-foreground px-1 mb-1">
                Snooze until…
              </p>
              {quickOptions.map((opt) => (
                <button
                  key={opt.label}
                  className="w-full flex items-center justify-between px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors text-left"
                  onClick={() => handleQuickSnooze(opt.date)}
                  data-testid={`snooze-option-${opt.label.toLowerCase().replace(/\s+/g, "-")}-${task.emailId}`}
                >
                  <span>{opt.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {format(opt.date, "EEE, MMM d")}
                  </span>
                </button>
              ))}
              <div className="border-t mt-1 pt-1 flex items-center gap-1">
                <input
                  type="date"
                  min={minDate}
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="flex-1 text-xs border rounded px-1.5 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid={`input-snooze-date-${task.emailId}`}
                />
                <Button
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={!customDate}
                  onClick={handleCustomSnooze}
                  data-testid={`button-snooze-custom-${task.emailId}`}
                >
                  Set
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                data-testid={`button-actions-${task.emailId}`}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setDropdownOpen(false);
                  setSnoozeOpen(true);
                }}
                data-testid={`menu-snooze-${task.emailId}`}
              >
                <BellOff className="h-4 w-4 mr-2" />
                Snooze…
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDismiss(task.emailId)}
                className="text-destructive focus:text-destructive"
                data-testid={`menu-dismiss-${task.emailId}`}
              >
                <X className="h-4 w-4 mr-2" />
                Dismiss
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({
  label,
  tasks,
  onToggle,
  onDismiss,
  onSnooze,
}: {
  label: string;
  tasks: InboxTask[];
  onToggle: (emailId: string, isDone: boolean) => void;
  onDismiss: (emailId: string) => void;
  onSnooze: (emailId: string, until: Date) => void;
}) {
  if (!tasks.length) return null;
  const undoneCount = tasks.filter((t) => !t.isDone).length;
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {undoneCount > 0 && (
          <Badge variant="secondary" className="text-xs px-1.5 py-0">
            {undoneCount}
          </Badge>
        )}
      </div>
      <div className="space-y-0.5">
        {tasks.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            onToggle={onToggle}
            onDismiss={onDismiss}
            onSnooze={onSnooze}
          />
        ))}
      </div>
    </div>
  );
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function TasksSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
          <Skeleton className="h-3 w-14 shrink-0" />
        </div>
      ))}
    </div>
  );
}

// ── Hidden task row ───────────────────────────────────────────────────────────

function HiddenTaskRow({
  task,
  onRestore,
  onDelete,
}: {
  task: InboxTask;
  onRestore: (emailId: string) => void;
  onDelete: (emailId: string) => void;
}) {
  const initials = senderInitials(task.sender);
  const color = senderColor(task.senderEmail ?? task.sender);
  const receivedAt = new Date(task.receivedAt);
  const isSnoozed = !task.dismissed && task.snoozedUntil != null;
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Permanently delete this email?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove this email. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-delete-cancel">Cancel</AlertDialogCancel>
          <AlertDialogAction
            data-testid="button-delete-confirm"
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => onDelete(task.emailId)}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <div
      className="flex items-center gap-3 p-3 rounded-lg opacity-60 hover:opacity-100 transition-opacity group"
      data-testid={`row-hidden-${task.emailId}`}
    >
      <div
        className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-white text-xs font-semibold ${color}`}
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium truncate">{task.subject}</span>
          <Badge variant="outline" className="text-xs px-1.5 py-0 shrink-0">
            {isSnoozed ? "Snoozed" : "Dismissed"}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate max-w-[200px]">{task.sender}</span>
          {isSnoozed && task.snoozedUntil && (
            <>
              <span>·</span>
              <span>
                Until {format(new Date(task.snoozedUntil), "MMM d, h:mm a")}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {isToday(receivedAt)
            ? format(receivedAt, "h:mm a")
            : format(receivedAt, "MMM d")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => onRestore(task.emailId)}
          data-testid={`button-restore-${task.emailId}`}
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          Restore
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
          onClick={() => setConfirmOpen(true)}
          data-testid={`button-delete-${task.emailId}`}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Delete
        </Button>
      </div>
    </div>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InboxTasks() {
  const { toast } = useToast();

  const [showDone, setShowDone] = useState(false);
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false);
  const [showClearDismissedDialog, setShowClearDismissedDialog] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Handle OAuth redirect result on page load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailConnected = params.get("gmail_connected");
    const gmailError = params.get("gmail_error");

    if (gmailConnected === "1") {
      toast({ title: "Gmail connected!", description: "Your inbox is syncing now." });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/status"] });
      // Trigger immediate refresh
      setTimeout(() => refreshMutation.mutate(), 500);
    } else if (gmailError) {
      const msg = gmailError === "invalid_state"
        ? "Security check failed. Please try connecting again."
        : gmailError === "access_denied"
        ? "Gmail access was denied. You can try again any time."
        : `Gmail connection error: ${gmailError}`;
      toast({ title: "Gmail connection failed", description: msg, variant: "destructive" });
    }

    // Clean URL
    if (gmailConnected || gmailError) {
      const url = new URL(window.location.href);
      url.searchParams.delete("gmail_connected");
      url.searchParams.delete("gmail_error");
      window.history.replaceState({}, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Connection status — polling every 30 s (now returns { connected, email })
  const { data: status, isLoading: statusLoading } = useQuery<{
    connected: boolean;
    email: string | null;
  }>({
    queryKey: ["/api/inbox/status"],
    refetchInterval: 30_000,
  });

  // Last auto-sync timestamp — polling every 60 s
  const { data: syncInfo } = useQuery<{ lastSyncedAt: string | null }>({
    queryKey: ["/api/inbox/last-sync"],
    refetchInterval: 60_000,
  });

  // Cached tasks for this user — re-fetches every 5 min while tab is visible
  const {
    data: tasks = [],
    isLoading: tasksLoading,
    isFetching: tasksFetching,
    dataUpdatedAt,
    refetch: refetchTasks,
  } = useQuery<InboxTask[]>({
    queryKey: ["/api/inbox/tasks"],
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
  });

  // Tick every 30 s so the "Updated X ago" label stays current
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Hidden (dismissed + snoozed) tasks — always fetched when connected so we
  // can show a count badge on the toggle even before the panel is opened
  const connected = status?.connected ?? false;

  // Label filter — current selection
  const { data: syncLabelsData, isLoading: syncLabelsLoading } = useQuery<{ labels: string[] }>({
    queryKey: ["/api/gmail/sync-labels"],
    enabled: connected,
  });
  const syncLabels = syncLabelsData?.labels ?? ["INBOX"];

  // Available Gmail labels — fetched on-demand (enabled by state)
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const { data: availableLabels = [], isLoading: labelsLoading } = useQuery<
    Array<{ id: string; name: string; type: string }>
  >({
    queryKey: ["/api/gmail/labels"],
    enabled: connected && labelPickerOpen,
    staleTime: 5 * 60 * 1000,
  });

  // Pending label selection state (local until saved)
  const [pendingLabels, setPendingLabels] = useState<string[] | null>(null);
  const displayLabels = pendingLabels ?? syncLabels;

  const saveLabelsMutation = useMutation({
    mutationFn: async (labels: string[]) => {
      await apiRequest("PATCH", "/api/gmail/sync-labels", { labels });
    },
    onSuccess: (_data, labels) => {
      queryClient.setQueryData(["/api/gmail/sync-labels"], { labels });
      setPendingLabels(null);
      toast({ title: "Label filter saved — refresh to apply" });
    },
    onError: () => {
      toast({ title: "Failed to save label filter", variant: "destructive" });
    },
  });

  const toggleLabel = (id: string) => {
    const current = pendingLabels ?? syncLabels;
    const next = current.includes(id) ? current.filter((l) => l !== id) : [...current, id];
    if (next.length === 0) return; // always keep at least one
    setPendingLabels(next);
  };

  const { data: hiddenTasks = [], isLoading: hiddenLoading } = useQuery<InboxTask[]>({
    queryKey: ["/api/inbox/tasks/hidden"],
    enabled: connected,
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
  });

  // Refresh — fetches live from the user's Gmail and upserts into cache
  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/inbox/messages");
      return res.json() as Promise<InboxTask[]>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/inbox/tasks"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/last-sync"] });
      toast({
        title: `Refreshed — ${data.length} email${data.length !== 1 ? "s" : ""}`,
      });
    },
    onError: () => {
      toast({ title: "Refresh failed", variant: "destructive" });
    },
  });

  // Auto-fetch on page load when connected but cache is empty
  useEffect(() => {
    if (
      status?.connected &&
      !tasksLoading &&
      tasks.length === 0 &&
      !refreshMutation.isPending
    ) {
      refreshMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected, tasksLoading]);

  // Connect — redirect browser to Google OAuth flow
  const handleConnect = () => {
    setConnecting(true);
    window.location.href = "/api/gmail/auth";
  };

  // Disconnect — removes the user's Google token and cached tasks
  const disconnectMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/gmail/disconnect");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/inbox/tasks"], []);
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/status"] });
      setShowDisconnectDialog(false);
      toast({ title: "Gmail disconnected" });
    },
    onError: () => {
      toast({ title: "Failed to disconnect", variant: "destructive" });
    },
  });

  const visibleTasks = showDone ? tasks : tasks.filter((t) => !t.isDone);
  const groups = groupByDay(visibleTasks);

  const todayTotal = tasks.filter((t) => isToday(new Date(t.receivedAt))).length;
  const todayDone = tasks.filter(
    (t) => isToday(new Date(t.receivedAt)) && t.isDone
  ).length;
  const todayUndone = todayTotal - todayDone;
  const unreadCount = tasks.filter((t) => !t.isRead && !t.isDone).length;

  const isLoading = statusLoading || tasksLoading;
  const showNotConnected = !isLoading && !connected;
  const showEmptyConnected = !isLoading && connected && visibleTasks.length === 0;
  const showList = !isLoading && connected && visibleTasks.length > 0;

  const handleToggle = (emailId: string, isDone: boolean) => {
    queryClient.setQueryData(["/api/inbox/tasks"], (old: InboxTask[] = []) =>
      old.map((t) => (t.emailId === emailId ? { ...t, isDone } : t))
    );
    apiRequest("PATCH", `/api/inbox/tasks/${emailId}/done`, { isDone }).catch(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks"] });
      toast({ title: "Couldn't update task", variant: "destructive" });
    });
  };

  const handleDismiss = (emailId: string) => {
    const dismissed = tasks.find((t) => t.emailId === emailId);
    queryClient.setQueryData(["/api/inbox/tasks"], (old: InboxTask[] = []) =>
      old.filter((t) => t.emailId !== emailId)
    );
    if (dismissed) {
      queryClient.setQueryData(["/api/inbox/tasks/hidden"], (old: InboxTask[] = []) => {
        const exists = old.some((t) => t.emailId === emailId);
        const updated = old.map((t) =>
          t.emailId === emailId ? { ...t, dismissed: true, snoozedUntil: null } : t
        );
        return exists ? updated : [{ ...dismissed, dismissed: true, snoozedUntil: null }, ...old];
      });
    }
    apiRequest("PATCH", `/api/inbox/tasks/${emailId}/dismiss`).then(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
    }).catch(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      toast({ title: "Couldn't dismiss task", variant: "destructive" });
    });
    toast({ title: "Email dismissed" });
  };

  const handleSnooze = (emailId: string, until: Date) => {
    const snoozed = tasks.find((t) => t.emailId === emailId);
    queryClient.setQueryData(["/api/inbox/tasks"], (old: InboxTask[] = []) =>
      old.filter((t) => t.emailId !== emailId)
    );
    if (snoozed) {
      queryClient.setQueryData(["/api/inbox/tasks/hidden"], (old: InboxTask[] = []) => {
        const exists = old.some((t) => t.emailId === emailId);
        const updated = old.map((t) =>
          t.emailId === emailId ? { ...t, snoozedUntil: until.toISOString(), dismissed: false } : t
        );
        return exists ? updated : [{ ...snoozed, snoozedUntil: until.toISOString(), dismissed: false }, ...old];
      });
    }
    apiRequest("PATCH", `/api/inbox/tasks/${emailId}/snooze`, { until: until.toISOString() }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
    }).catch(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      toast({ title: "Couldn't snooze task", variant: "destructive" });
    });
    toast({ title: `Snoozed until ${format(until, "EEE, MMM d")}` });
  };

  const handleRestore = (emailId: string) => {
    queryClient.setQueryData(["/api/inbox/tasks/hidden"], (old: InboxTask[] = []) =>
      old.filter((t) => t.emailId !== emailId)
    );
    apiRequest("PATCH", `/api/inbox/tasks/${emailId}/restore`).then(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
    }).catch(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      toast({ title: "Couldn't restore task", variant: "destructive" });
    });
    toast({ title: "Email restored" });
  };

  const handleDelete = (emailId: string) => {
    queryClient.setQueryData(["/api/inbox/tasks/hidden"], (old: InboxTask[] = []) =>
      old.filter((t) => t.emailId !== emailId)
    );
    apiRequest("DELETE", `/api/inbox/tasks/${emailId}`).catch(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      toast({ title: "Couldn't delete email", variant: "destructive" });
    });
    toast({ title: "Email permanently deleted" });
  };

  const handleClearAllDismissed = () => {
    const hidden: InboxTask[] = queryClient.getQueryData(["/api/inbox/tasks/hidden"]) ?? [];
    const dismissedCount = hidden.filter((t) => t.dismissed).length;
    queryClient.setQueryData(["/api/inbox/tasks/hidden"], (old: InboxTask[] = []) =>
      old.filter((t) => !t.dismissed)
    );
    apiRequest("DELETE", "/api/inbox/tasks/dismissed").catch(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/inbox/tasks/hidden"] });
      toast({ title: "Couldn't clear dismissed emails", variant: "destructive" });
    });
    toast({ title: `${dismissedCount} email${dismissedCount !== 1 ? "s" : ""} permanently deleted` });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Clear all dismissed confirmation */}
      <AlertDialog
        open={showClearDismissedDialog}
        onOpenChange={setShowClearDismissedDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all dismissed emails?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all dismissed emails. Snoozed emails will not be affected. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-clear-dismissed-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-clear-dismissed-confirm"
              onClick={() => {
                setShowClearDismissedDialog(false);
                handleClearAllDismissed();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear all dismissed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Disconnect confirmation */}
      <AlertDialog
        open={showDisconnectDialog}
        onOpenChange={setShowDisconnectDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Gmail?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove your Gmail connection and delete your cached inbox tasks.
              You can reconnect at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => disconnectMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-semibold flex items-center gap-2">
            <Inbox className="h-7 w-7" />
            Inbox Tasks
          </h1>
          <p className="text-muted-foreground mt-1">
            Your Gmail inbox as a daily to-do list
          </p>
          {syncInfo?.lastSyncedAt && (
            <p
              className="text-xs text-muted-foreground mt-0.5"
              data-testid="text-last-synced"
              title={format(new Date(syncInfo.lastSyncedAt), "PPpp")}
            >
              <Clock className="h-3 w-3 inline mr-1" />
              Auto-synced{" "}
              {formatDistanceToNow(new Date(syncInfo.lastSyncedAt), {
                addSuffix: true,
              })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Connection indicator */}
          <div
            className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border ${
              connected
                ? "text-green-700 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-900/20 dark:border-green-800"
                : "text-muted-foreground bg-muted border-border"
            }`}
            data-testid="status-gmail-connection"
          >
            {connected ? (
              <Wifi className="h-3 w-3" />
            ) : (
              <WifiOff className="h-3 w-3" />
            )}
            {connected
              ? (status?.email ? status.email : "Gmail connected")
              : "Not connected"}
          </div>

          {/* Connect (when not connected) */}
          {!connected && !isLoading && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleConnect}
              disabled={connecting}
              data-testid="button-connect-gmail"
            >
              <PlugZap className="h-4 w-4 mr-1.5" />
              {connecting ? "Redirecting…" : "Connect Gmail"}
            </Button>
          )}

          {/* Disconnect */}
          {connected && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDisconnectDialog(true)}
              data-testid="button-disconnect-gmail"
              className="text-destructive hover:text-destructive"
            >
              <Unplug className="h-4 w-4 mr-1.5" />
              Disconnect
            </Button>
          )}

          {/* Show/hide done */}
          {connected && tasks.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDone((v) => !v)}
              data-testid="button-toggle-done"
            >
              <CheckCheck className="h-4 w-4 mr-1.5" />
              {showDone ? "Hide done" : "Show done"}
            </Button>
          )}

          {/* Label filter */}
          {connected && (
            <Popover
              open={labelPickerOpen}
              onOpenChange={(open) => {
                setLabelPickerOpen(open);
                if (!open) setPendingLabels(null);
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-label-filter"
                  className={labelPickerOpen ? "border-primary" : ""}
                >
                  <Tag className="h-4 w-4 mr-1.5" />
                  Labels
                  {syncLabels.length > 0 && !(syncLabels.length === 1 && syncLabels[0] === "INBOX") && (
                    <span className="ml-1.5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full h-4 w-4 flex items-center justify-center">
                      {syncLabels.length}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-0">
                <div className="px-3 py-2.5 border-b">
                  <p className="text-sm font-medium">Filter by Gmail label</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Only emails with <em>all</em> selected labels will sync.
                  </p>
                </div>
                <div className="py-1 max-h-64 overflow-y-auto">
                  {labelsLoading || syncLabelsLoading ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                      Loading labels…
                    </div>
                  ) : availableLabels.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                      No labels found
                    </div>
                  ) : (
                    availableLabels.map((label) => {
                      const checked = displayLabels.includes(label.id);
                      return (
                        <button
                          key={label.id}
                          onClick={() => toggleLabel(label.id)}
                          data-testid={`label-option-${label.id}`}
                          className="flex items-center gap-2.5 w-full px-3 py-1.5 text-sm hover:bg-muted transition-colors text-left"
                        >
                          <span
                            className={`h-4 w-4 rounded border flex-shrink-0 flex items-center justify-center ${
                              checked
                                ? "bg-primary border-primary"
                                : "border-border"
                            }`}
                          >
                            {checked && <Check className="h-3 w-3 text-primary-foreground" />}
                          </span>
                          <span className="truncate">{label.name}</span>
                          {label.type === "user" && (
                            <span className="ml-auto text-[10px] text-muted-foreground flex-shrink-0">
                              custom
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
                {pendingLabels !== null && (
                  <div className="px-3 py-2 border-t flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={saveLabelsMutation.isPending}
                      onClick={() => saveLabelsMutation.mutate(displayLabels)}
                      data-testid="button-save-labels"
                    >
                      {saveLabelsMutation.isPending ? "Saving…" : "Save filter"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPendingLabels(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          )}

          {/* Refresh (live Gmail fetch) */}
          {connected && (
            <Button
              size="sm"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              data-testid="button-refresh"
            >
              <RefreshCw
                className={`h-4 w-4 mr-1.5 ${
                  refreshMutation.isPending ? "animate-spin" : ""
                }`}
              />
              {refreshMutation.isPending ? "Refreshing…" : "Refresh"}
            </Button>
          )}
        </div>
      </div>

      {/* Stat cards — only when we have tasks */}
      {tasks.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-xs text-muted-foreground">Today</p>
                  <p className="text-xl font-bold">
                    {todayUndone}
                    <span className="text-sm font-normal text-muted-foreground ml-1">
                      / {todayTotal}
                    </span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2">
                <CircleDot className="h-4 w-4 text-blue-500" />
                <div>
                  <p className="text-xs text-muted-foreground">Unread</p>
                  <p className="text-xl font-bold">{unreadCount}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2">
                <CheckCheck className="h-4 w-4 text-green-600" />
                <div>
                  <p className="text-xs text-muted-foreground">Done today</p>
                  <p className="text-xl font-bold">{todayDone}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Last updated indicator + lightweight refresh */}
      {connected && dataUpdatedAt > 0 && (
        <div className="flex items-center justify-end gap-2 mb-2">
          <p
            className="text-xs text-muted-foreground select-none"
            data-testid="text-list-updated-at"
            title={new Date(dataUpdatedAt).toLocaleString()}
          >
            Updated{" "}
            {now - dataUpdatedAt < 60_000
              ? "just now"
              : formatDistanceToNow(new Date(dataUpdatedAt), { addSuffix: true })}
          </p>
          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            onClick={() => refetchTasks()}
            disabled={tasksFetching}
            data-testid="button-refresh-list"
          >
            <RefreshCw className={`h-3 w-3 ${tasksFetching ? "animate-spin" : ""}`} />
            Refresh list
          </button>
        </div>
      )}

      {/* Main content */}
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <TasksSkeleton />
          ) : showNotConnected ? (
            <NotConnectedCard
              onConnect={handleConnect}
              connecting={connecting}
            />
          ) : showEmptyConnected ? (
            <EmptyInboxCard
              onRefresh={() => refreshMutation.mutate()}
              loading={refreshMutation.isPending}
            />
          ) : showList ? (
            <>
              <Section
                label="Today"
                tasks={groups.today}
                onToggle={handleToggle}
                onDismiss={handleDismiss}
                onSnooze={handleSnooze}
              />
              <Section
                label="Yesterday"
                tasks={groups.yesterday}
                onToggle={handleToggle}
                onDismiss={handleDismiss}
                onSnooze={handleSnooze}
              />
              <Section
                label="Earlier"
                tasks={groups.earlier}
                onToggle={handleToggle}
                onDismiss={handleDismiss}
                onSnooze={handleSnooze}
              />
            </>
          ) : null}
        </CardContent>
      </Card>

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
                const snoozedCount = hiddenTasks.filter(
                  (t) => !t.dismissed && t.snoozedUntil != null
                ).length;
                const dismissedCount = hiddenTasks.filter((t) => t.dismissed).length;
                return (
                  <span
                    className="ml-1 flex items-center gap-1 text-xs text-muted-foreground"
                    data-testid="badge-hidden-count"
                  >
                    {snoozedCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="text-xs px-1.5 py-0 gap-1"
                        data-testid="badge-hidden-snoozed-count"
                      >
                        <Clock className="h-3 w-3" />
                        {snoozedCount} snoozed
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
            {hiddenTasks.some((t) => t.dismissed) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground hover:text-destructive h-7 px-2"
                onClick={() => setShowClearDismissedDialog(true)}
                data-testid="button-clear-all-dismissed"
              >
                Clear all dismissed
              </Button>
            )}
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
                  <div className="space-y-0.5">
                    {hiddenTasks.map((t) => (
                      <HiddenTaskRow
                        key={t.id}
                        task={t}
                        onRestore={handleRestore}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Footer hint */}
      {tasks.length > 0 && (
        <p className="text-xs text-muted-foreground text-center mt-4">
          <Clock className="h-3 w-3 inline mr-1" />
          Click a row or checkbox to mark done · Hover a row for dismiss/snooze options
        </p>
      )}
    </div>
  );
}
